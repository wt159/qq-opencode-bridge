import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Config, PermissionData } from '../types.js';
import { BridgeError } from '../types.js';
import { SessionManager } from './session.js';
import { ProcessManager } from './process.js';
import { OpenCodeClient } from '../services/opencode.js';
import { NapCatService } from '../services/napcat.js';
import { validateProjectPath } from './whitelist.js';
import { info } from '../utils/logger.js';
import { PermissionRules } from './permission-rules.js';
import { EventProcessor } from './event-processor.js';

type OpenCodeProviderModel = {
  id: string;
  name: string;
};

type OpenCodeProvider = {
  id: string;
  models: Record<string, OpenCodeProviderModel> | OpenCodeProviderModel[];
};

export class BridgeHandlers {
  constructor(
    private config: Config,
    private sessions: SessionManager,
    private processes: ProcessManager,
    private napcat: NapCatService,
  ) {}

  private activeProcessors = new Map<string, EventProcessor>();

  private get permissionRules(): PermissionRules {
    const perms = this.config.permissions;
    return new PermissionRules(
      perms?.autoApprovePatterns ?? [],
      perms?.defaultAction ?? 'ask',
    );
  }

  private getClient(qq: string): OpenCodeClient {
    const s = this.sessions.getOrCreate(qq);
    if (!s.projectPort) throw new BridgeError('ERR_NO_BIND', '请先使用 /bind <项目路径> 绑定项目');
    return new OpenCodeClient(s.projectPort, this.config.opencode.password);
  }

  private toModelId(model: string | null): { providerID: string; modelID: string } | undefined {
    if (!model) return undefined;
    const [providerID, ...rest] = model.split('/');
    if (!providerID || rest.length === 0) return undefined;
    return { providerID, modelID: rest.join('/') };
  }

  private async resolveRunModel(qq: string): Promise<{ providerID: string; modelID: string } | undefined> {
    const session = this.sessions.getOrCreate(qq);
    const explicitModel = this.toModelId(session.model);
    if (explicitModel) return explicitModel;

    return this.resolveDefaultRunModel(session.projectPort);
  }

  private async resolveDefaultRunModel(port: number | null): Promise<{ providerID: string; modelID: string } | undefined> {
    if (!port) return undefined;

    const client = new OpenCodeClient(port, this.config.opencode.password);
    const { providers, default: defaultModels } = await client.getProviders();
    const defaultModelID = defaultModels.opencode;
    if (defaultModelID) {
      return { providerID: 'opencode', modelID: defaultModelID };
    }

    let opencodeProvider: OpenCodeProvider | undefined;
    for (const provider of providers) {
      if (provider.id === 'opencode') {
        opencodeProvider = provider;
        break;
      }
    }
    if (!opencodeProvider) return undefined;

    const models = Array.isArray(opencodeProvider.models)
      ? opencodeProvider.models
      : Object.values(opencodeProvider.models);

    const firstModel = models[0];
    return firstModel ? { providerID: opencodeProvider.id, modelID: firstModel.id } : undefined;
  }

  private extractEventText(event: { type: string; properties?: unknown }): string | null {
    const props = event.properties as {
      part?: { type?: string; text?: string };
      error?: { data?: { message?: string } };
      status?: { type?: string };
    } | undefined;

    if (event.type === 'message.part.updated') {
      const part = props?.part;
      if (part?.type === 'text' && part.text) return part.text;
    }

    return null;
  }

  private async reply(qq: string, text: string, isGroup: boolean, groupId?: number) {
    const msg = [{ type: 'text', data: { text } }];
    if (isGroup && groupId) {
      await this.napcat.sendGroupMsg(groupId, msg);
    } else {
      await this.napcat.sendPrivateMsg(qq, msg);
    }
  }

  async handleBind(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const projectPath = args.trim();
    if (!projectPath) {
      return this.reply(qq, '用法: /bind <项目路径>', isGroup, groupId);
    }

    try {
      const resolved = validateProjectPath(projectPath, this.config.workspaceRoot);
      if (!existsSync(resolved)) {
        return this.reply(qq, `项目不存在: ${resolved}`, isGroup, groupId);
      }

       let instance = this.processes.getInstance(resolved);
       let port: number = this.processes.allocatePort();

       if (instance) {
         port = instance.port;
       } else {
         // Try to discover existing OpenCode instances in port range
         const [minPort, maxPort] = this.config.opencode.portRange;
         let discovered = false;
         for (let p = minPort; p <= maxPort; p++) {
           try {
             const probe = new OpenCodeClient(p, this.config.opencode.password);
             if (await probe.isHealthy()) {
               const sessions = await probe.listSessions();
               if (sessions.length > 0) {
                 const dir = sessions[0].directory;
                 if (dir === resolved) {
                   port = p;
                   discovered = true;
                   this.processes.addInstance(resolved, p, 0);
                   instance = this.processes.getInstance(resolved);
                   break;
                 }
               }
             }
           } catch { /* port not running OpenCode */ }
         }

         if (!discovered) {
           instance = await this.processes.startInstance(
             this.config.opencode.binaryPath,
             resolved,
             port,
             this.config.opencode.password,
           );
         }
       }

      const client = new OpenCodeClient(port, this.config.opencode.password);
      let ready = false;
      for (let i = 0; i < 30; i++) {
        if (await client.isHealthy()) { ready = true; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!ready) {
        return this.reply(qq, '项目启动失败，请检查日志', isGroup, groupId);
      }

      const session = await client.createSession(`QQ-${qq}`);
      this.sessions.bindProject(qq, resolved, port, session.id);
      if (instance) instance.sessions.add(qq);

      return this.reply(qq, `已绑定: ${resolved}`, isGroup, groupId);
    } catch (e) {
      if (e instanceof BridgeError) {
        return this.reply(qq, e.message, isGroup, groupId);
      }
      return this.reply(qq, `绑定失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handleUnbind(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const session = this.sessions.getOrCreate(qq);
    const projectPath = session.projectPath;
    this.sessions.unbind(qq);

    if (!projectPath) {
      return this.reply(qq, '已解除绑定', isGroup, groupId);
    }

    const instance = this.processes.getInstance(projectPath);
    if (instance) {
      instance.sessions.delete(qq);
      if (instance.sessions.size === 0) {
        this.processes.stopInstance(projectPath);
        return this.reply(qq, '已解除绑定，项目已关闭', isGroup, groupId);
      }
    }

    return this.reply(qq, '已解除绑定', isGroup, groupId);
  }

  async handleSwitch(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const projectPath = args.trim();
    if (!projectPath) {
      return this.reply(qq, '用法: /switch <项目路径>', isGroup, groupId);
    }

    try {
      const resolved = validateProjectPath(projectPath, this.config.workspaceRoot);
      const targetInstance = this.processes.getInstance(resolved);
      if (!targetInstance) {
        return this.reply(qq, `项目未运行: ${resolved}`, isGroup, groupId);
      }

      const current = this.sessions.getOrCreate(qq);
      const previousPath = current.projectPath;

      if (previousPath === resolved) {
        return this.reply(qq, `已在当前项目: ${resolved}`, isGroup, groupId);
      }

      if (previousPath) {
        const previousInstance = this.processes.getInstance(previousPath);
        previousInstance?.sessions.delete(qq);
      }

      const client = new OpenCodeClient(targetInstance.port, this.config.opencode.password);
      const session = await client.createSession(`QQ-${qq}`);
      this.sessions.bindProject(qq, resolved, targetInstance.port, session.id);
      targetInstance.sessions.add(qq);

      return this.reply(qq, `已切换到: ${resolved}`, isGroup, groupId);
    } catch (e) {
      return this.reply(qq, `切换失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handleStatus(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    const lines = [
      `项目: ${s.projectPath || '未绑定'}`,
      `模型: ${s.model || '默认'}`,
      `状态: ${s.state}`,
    ];
    return this.reply(qq, lines.join('\n'), isGroup, groupId);
  }

  async handleList(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const instances = this.processes.getInstances();
    if (instances.size === 0) {
      return this.reply(qq, '没有运行中的项目', isGroup, groupId);
    }
    const lines = ['运行中的项目:'];
    let i = 1;
    for (const [path, inst] of instances) {
      lines.push(`${i}. ${path} (port:${inst.port})`);
      i++;
    }
    return this.reply(qq, lines.join('\n'), isGroup, groupId);
  }

  async handleRun(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (!s.sessionId) return this.reply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);
    if (s.state === 'permission_pending') return this.reply(qq, '请先 /approve 或 /reject 当前权限请求', isGroup, groupId);
    if (s.state !== 'idle') return this.reply(qq, '当前有命令正在执行，请稍后或使用 /abort 中断', isGroup, groupId);

    s.state = 'running';
    await this.reply(qq, '正在执行...', isGroup, groupId);

    try {
      const client = this.getClient(qq);
      const model = await this.resolveRunModel(qq);
      const events = client.subscribeEvents(s.sessionId!);
      const eventIterator = events[Symbol.asyncIterator]();

      let responseReady = false;
      const timeoutMs = Math.max(this.config.opencode.commandTimeout, 30 * 60 * 1000);
      const timeout = setTimeout(() => {
        if (!responseReady) {
          events.controller.abort();
          s.state = 'idle';
          this.activeProcessors.delete(qq);
          this.reply(qq, '命令执行超时，请稍后重试', isGroup, groupId);
        }
      }, timeoutMs);

      const sendWithModel = async (currentModel: { providerID: string; modelID: string } | undefined) => {
        await client.sendMessage(s.sessionId!, args, currentModel, events.controller.signal);
      };

      try {
        await sendWithModel(model);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('Model not found')) {
          const fallbackModel = await this.resolveDefaultRunModel(s.projectPort);
          if (fallbackModel && (!model || model.providerID !== fallbackModel.providerID || model.modelID !== fallbackModel.modelID)) {
            s.model = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
            await sendWithModel(fallbackModel);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }

      const processor = new EventProcessor(
        this.permissionRules,
        client,
        s.sessionId!,
        {
          onText: () => {},
          onPermissionRequest: (perm: PermissionData) => {
            this.sessions.setPendingPermission(qq, perm.id);
            this.reply(qq, `⚠️ 权限请求: ${perm.title}\n使用 /approve 或 /reject 回复`, isGroup, groupId);
          },
          onComplete: (text: string) => {
            responseReady = true;
            clearTimeout(timeout);
            this.sessions.clearPendingPermission(qq, 'idle');
            this.activeProcessors.delete(qq);
            this.reply(qq, text || '(无输出)', isGroup, groupId);
          },
          onError: (errorMsg: string) => {
            responseReady = true;
            clearTimeout(timeout);
            this.sessions.clearPendingPermission(qq, 'idle');
            this.activeProcessors.delete(qq);
            this.reply(qq, `执行失败: ${errorMsg}`, isGroup, groupId);
          },
        },
      );
      this.activeProcessors.set(qq, processor);

      try {
        let next = await eventIterator.next();
        while (!next.done) {
          const event = next.value;
          await processor.handleEvent(event);
          if (processor.currentState === 'done') {
            responseReady = true;
            clearTimeout(timeout);
            break;
          }
          next = await eventIterator.next();
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!responseReady) {
          this.reply(qq, `执行失败: ${message}`, isGroup, groupId);
        }
      } finally {
        events.controller.abort();
        this.activeProcessors.delete(qq);
      }

      s.state = 'idle';
    } catch (e) {
      s.state = 'idle';
      this.activeProcessors.delete(qq);
      return this.reply(qq, `执行失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handleAbort(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'running' && s.state !== 'permission_pending') {
      return this.reply(qq, '当前没有正在执行的命令', isGroup, groupId);
    }

    s.state = 'aborting';
    try {
      const client = this.getClient(qq);
      await client.abort(s.sessionId!);
      s.state = 'idle';
      s.pendingPermissionId = null;
      this.activeProcessors.delete(qq);
      return this.reply(qq, '已中断', isGroup, groupId);
    } catch (e) {
      s.state = 'idle';
      s.pendingPermissionId = null;
      this.activeProcessors.delete(qq);
      return this.reply(qq, `中断失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handleModes(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const client = this.getClient(qq);

    if (!args.trim()) {
      const { providers } = await client.getProviders();
      const lines = ['可用模型:'];
      for (const p of providers) {
        const models = Array.isArray(p.models)
          ? p.models
          : (Object.values(p.models) as OpenCodeProviderModel[]);
        for (const m of models) {
          const modelId = m.id;
          lines.push(`- ${p.id}/${modelId}`);
        }
      }
      return this.reply(qq, lines.join('\n'), isGroup, groupId);
    }

    const { providers } = await client.getProviders();
    const allModels: string[] = [];
    for (const p of providers) {
      const models = Array.isArray(p.models)
        ? p.models
        : (Object.values(p.models) as OpenCodeProviderModel[]);
      for (const m of models) {
        allModels.push(`${p.id}/${m.id}`);
      }
    }
    if (!allModels.includes(args.trim())) {
      return this.reply(qq, `模型不存在: ${args.trim()}`, isGroup, groupId);
    }

    this.sessions.setModel(qq, args.trim());
    return this.reply(qq, `已切换为: ${args.trim()}`, isGroup, groupId);
  }

  private chunkLines(lines: string[], maxChars: number = 2900): string[][] {
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = 0;
    for (const line of lines) {
      const lineLen = line.length;
      const extra = current.length > 0 ? 1 + lineLen : lineLen;
      if (currentLen + extra <= maxChars) {
        current.push(line);
        currentLen += extra;
      } else {
        if (current.length) chunks.push(current);
        current = [line];
        currentLen = lineLen;
      }
    }
    if (current.length) chunks.push(current);
    return chunks;
  }

  async handleCommands(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const client = this.getClient(qq);
    const cmds = await client.listCommands();
    if (!cmds || cmds.length === 0) {
      return this.reply(qq, '当前实例没有可用命令', isGroup, groupId);
    }

    const names = cmds.map(c => c.name);
    const bodyLines = names.map(n => `- /oc ${n}`);
    const chunks = this.chunkLines(bodyLines, 2900);

    const totalChunks = chunks.length;
    for (let i = 0; i < totalChunks; i++) {
      const header = i === 0
        ? `可用命令（${names.length} 个）:`
        : `可用命令（第${i + 1}/${totalChunks} 段，共${totalChunks}个）:`;
      const text = header + (chunks[i].length ? '\n' + chunks[i].join('\n') : '');
      await this.reply(qq, text, isGroup, groupId);
    }
  }

  async handleOpenCodeCmd(qq: string, command: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (!s.sessionId) return this.reply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);

    if (command === 'help' || !command) {
      return this.handleCommands(qq, isGroup, groupId);
    }

    try {
      const client = this.getClient(qq);
      const result = await client.sendCommand(s.sessionId!, command, args);
      const text = result.parts.map(p => p.type === 'text' ? p.text : '').filter(Boolean).join('\n');
      return this.reply(qq, text || `(命令 ${command} 已执行)`, isGroup, groupId);
    } catch (e) {
      return this.reply(qq, `命令执行失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handlePermission(qq: string, approve: boolean, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'permission_pending' || !s.pendingPermissionId) {
      return this.reply(qq, '当前没有待确认的权限请求', isGroup, groupId);
    }

    const processor = this.activeProcessors.get(qq);
    if (!processor) {
      return this.reply(qq, '没有活跃的执行会话', isGroup, groupId);
    }

    const response = approve ? 'once' : 'reject';
    try {
      await processor.respondToPermission(s.pendingPermissionId, response);
      this.sessions.clearPendingPermission(qq, 'running');
      return this.reply(qq, approve ? '✅ 已授权' : '❌ 已拒绝', isGroup, groupId);
    } catch (e) {
      return this.reply(qq, `授权失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  async handleStop(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const projectPath = args.trim();
    if (!projectPath) return this.reply(qq, '用法: /stop <项目路径>', isGroup, groupId);

    const resolved = resolve(this.config.workspaceRoot, projectPath);
    const instance = this.processes.getInstance(resolved);
    if (!instance) return this.reply(qq, `项目未运行: ${resolved}`, isGroup, groupId);

    for (const session of this.sessions.getAll()) {
      if (session.projectPath === resolved) {
        this.sessions.unbind(session.qq);
        await this.reply(session.qq, `项目已关闭: ${resolved}`, false);
      }
    }

    this.processes.stopInstance(resolved);
    return this.reply(qq, `已关闭: ${resolved}`, isGroup, groupId);
  }

  async handleStopAll(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const count = this.processes.getInstances().size;
    this.processes.stopAll();
    for (const session of this.sessions.getAll()) {
      this.sessions.unbind(session.qq);
    }
    return this.reply(qq, `已关闭所有项目 (共${count}个)`, isGroup, groupId);
  }
}
