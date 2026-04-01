import { loadConfig } from './config.js';
import { initLogger, info, error } from './utils/logger.js';
import { SessionManager } from './modules/session.js';
import { ProcessManager } from './modules/process.js';
import { BridgeHandlers } from './modules/handlers.js';
import { NapCatService } from './services/napcat.js';
import { parseCommand, normalizeMessage } from './modules/command.js';
import { isWhitelisted } from './modules/whitelist.js';
import { createProject, cloneProject, createDirectory, getDirectoryTree, listProjects } from './modules/filesystem.js';
import { resolve } from 'path';

async function main() {
  const configPath = process.argv[2] || './config.json';
  const config = loadConfig(configPath);
  initLogger(config);

  const sessions = new SessionManager();
  const processes = new ProcessManager(config.opencode.portRange);
  const napcat = new NapCatService(config);

  const handlers = new BridgeHandlers(config, sessions, processes, napcat);

  await napcat.start(async (event) => {
    const qq = String(event.user_id);
    if (!isWhitelisted(qq, config.whitelist)) return;

    const normalized = normalizeMessage(
      event.message_type,
      event.message,
      config.napcat.botQQ,
    );
    if (!normalized) return;

    const parsed = parseCommand(normalized);
    if (!parsed) {
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      return;
    }

    const isGroup = event.message_type === 'group';
    const groupId = event.group_id;

    try {
      switch (parsed.command) {
        case 'bind': await handlers.handleBind(qq, parsed.args, isGroup, groupId); break;
        case 'unbind': await handlers.handleUnbind(qq, isGroup, groupId); break;
        case 'status': await handlers.handleStatus(qq, isGroup, groupId); break;
        case 'list': await handlers.handleList(qq, isGroup, groupId); break;
        case 'run': await handlers.handleRun(qq, parsed.args, isGroup, groupId); break;
        case 'abort': await handlers.handleAbort(qq, isGroup, groupId); break;
        case 'modes': await handlers.handleModes(qq, parsed.args, isGroup, groupId); break;
        case 'commands': await handlers.handleCommands(qq, isGroup, groupId); break;
        case 'approve': await handlers.handlePermission(qq, true, isGroup, groupId); break;
        case 'reject': await handlers.handlePermission(qq, false, isGroup, groupId); break;
        case 'stop': await handlers.handleStop(qq, parsed.args, isGroup, groupId); break;
        case 'stopall': await handlers.handleStopAll(qq, isGroup, groupId); break;
        case 'ls': {
          const path = parsed.args || config.workspaceRoot;
          const resolved = resolve(config.workspaceRoot, path);
          const projects = listProjects(resolved);
          const msg = projects.length > 0
            ? `项目列表:\n${projects.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
            : '没有找到项目';
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: msg } }]);
          break;
        }
        case 'new': {
          const parts = parsed.args.trim().split(/\s+/);
          if (parts.length === 1) {
            const path = createProject(config.workspaceRoot, parts[0]);
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 项目已创建: ${path}` } }]);
          } else if (parts.length >= 2) {
            const path = cloneProject(config.workspaceRoot, parts[0], parts.slice(1).join(' '));
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 项目已克隆: ${path}` } }]);
          } else {
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '用法: /new <name> 或 /new <url> <name>' } }]);
          }
          break;
        }
        case 'mkdir': {
          const s = sessions.getOrCreate(qq);
          const base = s.projectPath || config.workspaceRoot;
          const path = createDirectory(base, parsed.args);
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 目录已创建: ${path}` } }]);
          break;
        }
        case 'tree': {
          const s = sessions.getOrCreate(qq);
          const base = parsed.args ? resolve(config.workspaceRoot, parsed.args) : (s.projectPath || config.workspaceRoot);
          const tree = getDirectoryTree(base);
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: tree } }]);
          break;
        }
        case 'help': {
          const help = `可用命令:
/bind <path> - 绑定项目
/unbind - 解除绑定
/status - 查看状态
/list - 列出运行中的项目
/ls [path] - 列出项目目录
/new <name> | <url> <name> - 新建/克隆项目
/mkdir <path> - 创建目录
/tree [path] - 显示目录树
/modes [model] - 模型切换
/commands - 列出 OpenCode 命令
/run <msg> - 执行指令
/abort - 中断执行
/approve - 授权权限请求
/reject - 拒绝权限请求
/oc <cmd> - 执行 OpenCode 命令
/stop <path> - 关闭项目
/stopall - 关闭所有项目`;
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: help } }]);
          break;
        }
        default:
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      }
    } catch (e) {
      error('Handler error', e);
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `内部错误: ${e instanceof Error ? e.message : String(e)}` } }]);
    }
  });

  info('QQ-OpenCode Bridge started');

  process.on('SIGINT', () => {
    info('Shutting down...');
    processes.stopAll();
    napcat.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    processes.stopAll();
    napcat.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  error('Failed to start', e);
  process.exit(1);
});
