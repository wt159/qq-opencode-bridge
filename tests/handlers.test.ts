import { beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'http';
import { once } from 'events';
import { BridgeHandlers } from '../src/modules/handlers.js';
import { ProcessManager } from '../src/modules/process.js';
import { SessionManager } from '../src/modules/session.js';
import type { Config, SessionState } from '../src/types.js';
import { NapCatService } from '../src/services/napcat.js';

class MockNapCatService extends NapCatService {
  messages: Array<{ qq: string; message: string | unknown[]; groupId?: number }> = [];

  constructor(config: Config) {
    super(config);
  }

  override async sendPrivateMsg(qq: string, message: string | unknown[]): Promise<void> {
    this.messages.push({ qq, message });
  }

  override async sendGroupMsg(groupId: number, message: string | unknown[]): Promise<void> {
    this.messages.push({ qq: String(groupId), message, groupId });
  }
}

let sessions: SessionManager;
let napcat: MockNapCatService;

// Helper functions shared across test suites
function createMockOpenCodeServer() {
  let sseRes: ServerResponse | null = null;
  let sseReadyResolve!: () => void;
  const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

  let messageReadyResolve!: () => void;
  const messageReady = new Promise<void>((r) => { messageReadyResolve = r; });

  const permissionCalls: Array<{ sessionId: string; permissionId: string; body: string }> = [];

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      sseRes = res;
      req.on('close', () => { sseRes = null; });
      sseReadyResolve();
      return;
    }

    if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/message$/)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ parts: [] }));
      messageReadyResolve();
      return;
    }

    if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        const match = req.url!.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/);
        permissionCalls.push({ sessionId: match![1], permissionId: match![2], body });
        res.writeHead(204);
        res.end();
      });
      return;
    }

    if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/abort$/)) {
      res.writeHead(204);
      res.end();
      if (sseRes && !sseRes.writableEnded) {
        sseRes.end();
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/config/providers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providers: [], default: {} }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  function sendSSE(event: object) {
    if (sseRes && !sseRes.writableEnded) {
      sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  return { server, sendSSE, sseReady, messageReady, permissionCalls };
}

async function waitForState(qq: string, state: SessionState, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (sessions.getOrCreate(qq).state === state) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for state '${state}', current: '${sessions.getOrCreate(qq).state}'`);
}

function getLastReplyText(): string {
  const last = napcat.messages.at(-1);
  if (!last) return '';
  if (Array.isArray(last.message)) {
    const first = last.message[0] as { type: string; data: { text: string } } | undefined;
    return first?.data?.text ?? '';
  }
  return '';
}

describe('BridgeHandlers unbind', () => {
  const config: Config = {
    whitelist: ['123'],
    workspaceRoot: '/home/wtp/workspace/opencode-napcatqq',
    napcat: {
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      botQQ: '3260465307',
    },
    opencode: {
      binaryPath: 'opencode',
      portRange: [3002, 3010],
      commandTimeout: 60000,
    },
    concurrency: {
      allowMultiQQPerProject: false,
      rejectWhenBusy: false,
      abortOwnOnly: true,
    },
    log: {
      level: 'INFO',
    },
  };

  let processes: ProcessManager;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    sessions = new SessionManager();
    processes = new ProcessManager([3002, 3010]);
    napcat = new MockNapCatService(config);
    handlers = new BridgeHandlers(config, sessions, processes, napcat);
  });

  it('returns compact commands list without descriptions', async () => {
    // Mock OpenCode GET /command to return two commands
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/command') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ name: 'init' }, { name: 'review' }]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    // Bind a test QQ to a project running on a dynamically assigned port (OpenCode mock server)
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('failed to start mock opencode server');
    const port = address.port;

    sessions.bindProject('123', '/home/wtp/workspace/opencode-napcatqq/commands-test', port, 'ses_commands');

    // Trigger the handler
    await handlers.handleCommands('123', false);

    expect(napcat.messages.at(-1)?.message).toEqual([
      {
        type: 'text',
        data: { text: '可用命令（2 个）:\n- /oc init\n- /oc review' },
      },
    ]);

    server.close();
  });

  it('splits long commands list into multiple messages on line boundaries', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/command') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const cmds = Array.from({ length: 210 }, (_v, i) => ({
          name: `cmd-${(i + 1).toString().padStart(3, '0')}`,
        }));
        res.end(JSON.stringify(cmds));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('failed to start mock opencode server');
    const port = address.port;

    sessions.bindProject('123', '/home/wtp/workspace/opencode-napcatqq/commands-test-long', port, 'ses_commands_long');

    
    await handlers.handleCommands('123', false);

    
    expect(napcat.messages.length).toBeGreaterThan(1);

    
    napcat.messages.forEach((m) => {
      if (Array.isArray(m.message)) {
        const first = (m.message[0] as { type: string; data: { text: string } } | undefined);
        const text = first?.data?.text;
        if (typeof text === 'string') {
          const firstLine = text.split(/\n/)[0];
          expect(firstLine.startsWith('可用命令（') || firstLine.startsWith('可用命令（第')).toBeTruthy();
        }
      } else if (typeof m.message === 'string') {
        const text = m.message;
        const firstLine = text.split(/\n/)[0];
        expect(firstLine.startsWith('可用命令（') || firstLine.startsWith('可用命令（第')).toBeTruthy();
      }
    });

    
    napcat.messages.forEach((m) => {
      if (Array.isArray(m.message)) {
        const first = (m.message[0] as { type: string; data: { text: string } } | undefined);
        const text = first?.data?.text;
        if (typeof text === 'string') {
          text.split(/\n/).forEach((ln) => {
            if (ln.trim().startsWith('- /oc')) {
              expect(ln).toMatch(/- \/oc [^\s]+/);
            }
          });
        }
      } else if (typeof m.message === 'string') {
        const text = m.message;
        text.split(/\n/).forEach((ln) => {
          if (ln.trim().startsWith('- /oc')) {
            expect(ln).toMatch(/- \/oc [^\s]+/);
          }
        });
      }
    });

    server.close();
  });

  it('returns empty command message when OpenCode exposes none', async () => {
    // Mock OpenCode GET /command to return empty array
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/command') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(3003, '127.0.0.1');
    await once(server, 'listening');

    sessions.bindProject('123', '/home/wtp/workspace/opencode-napcatqq/commands-test', 3003, 'ses_commands_none');

    await handlers.handleCommands('123', false);

    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '当前实例没有可用命令' } },
    ]);

    server.close();
  });

  it('stops project when the last QQ unbinds', async () => {
    sessions.bindProject('123', '/home/wtp/workspace/cosmos', 3002, 'ses_1');
    processes.addInstance('/home/wtp/workspace/cosmos', 3002, 1234);
    processes.getInstance('/home/wtp/workspace/cosmos')?.sessions.add('123');

    await handlers.handleUnbind('123', false);

    expect(sessions.getOrCreate('123').projectPath).toBeNull();
    expect(processes.getInstance('/home/wtp/workspace/cosmos')).toBeUndefined();
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '已解除绑定，项目已关闭' } },
    ]);
  });

  it('switches QQ session to another running project', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/session') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'ses_switch_target' }));
        return;
      }

      if (req.method === 'GET' && req.url === '/global/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ healthy: true }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('failed to start mock opencode server');
    const port = address.port;

    const switchConfig: Config = {
      ...config,
      opencode: { ...config.opencode, commandTimeout: 60000 },
    };

    processes.addInstance('/home/wtp/workspace/opencode-napcatqq/old-project', 3002, 1234);
    processes.getInstance('/home/wtp/workspace/opencode-napcatqq/old-project')?.sessions.add('123');
    sessions.bindProject('123', '/home/wtp/workspace/opencode-napcatqq/old-project', 3002, 'ses_old');

    processes.addInstance('/home/wtp/workspace/opencode-napcatqq/cosmos', port, 5678);

    const switchHandlers = new BridgeHandlers(switchConfig, sessions, processes, napcat);
    await switchHandlers.handleSwitch('123', 'cosmos', false);

    expect(sessions.getOrCreate('123').projectPath).toBe('/home/wtp/workspace/opencode-napcatqq/cosmos');
    expect(sessions.getOrCreate('123').projectPort).toBe(port);
    expect(sessions.getOrCreate('123').sessionId).toBe('ses_switch_target');
    expect(processes.getInstance('/home/wtp/workspace/opencode-napcatqq/old-project')?.sessions.has('123')).toBe(false);
    expect(processes.getInstance('/home/wtp/workspace/opencode-napcatqq/cosmos')?.sessions.has('123')).toBe(true);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '已切换到: /home/wtp/workspace/opencode-napcatqq/cosmos' } },
    ]);

    server.close();
  });
});

describe('BridgeHandlers permission', () => {
  const config: Config = {
    whitelist: ['123'],
    workspaceRoot: '/home/wtp/workspace/opencode-napcatqq',
    napcat: {
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      botQQ: '3260465307',
    },
    opencode: {
      binaryPath: 'opencode',
      portRange: [3002, 3010],
      commandTimeout: 60000,
    },
    concurrency: {
      allowMultiQQPerProject: false,
      rejectWhenBusy: false,
      abortOwnOnly: true,
    },
    log: {
      level: 'INFO',
    },
  };

  let sessions: SessionManager;
  let processes: ProcessManager;
  let napcat: MockNapCatService;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    sessions = new SessionManager();
    processes = new ProcessManager([3002, 3010]);
    napcat = new MockNapCatService(config);
    handlers = new BridgeHandlers(config, sessions, processes, napcat);
  });

  it('rejects approve when no permission pending', async () => {
    await handlers.handlePermission('123', true, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '当前没有待确认的权限请求' } },
    ]);
  });

  it('rejects reject when no permission pending', async () => {
    await handlers.handlePermission('123', false, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '当前没有待确认的权限请求' } },
    ]);
  });

  it('rejects approve when no active processor', async () => {
    sessions.bindProject('123', '/workspace/proj', 3002, 'ses-1');
    sessions.setPendingPermission('123', 'perm-1');
    await handlers.handlePermission('123', true, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '没有活跃的执行会话' } },
    ]);
  });

  it('rejects run when permission_pending', async () => {
    sessions.bindProject('123', '/workspace/proj', 3002, 'ses-1');
    sessions.setPendingPermission('123', 'perm-1');
    await handlers.handleRun('123', 'do something', false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '请先 /approve 或 /reject 当前权限请求' } },
    ]);
  });
});

describe('BridgeHandlers permission integration', () => {
  const config: Config = {
    whitelist: ['123'],
    workspaceRoot: '/home/wtp/workspace/opencode-napcatqq',
    napcat: {
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      botQQ: '3260465307',
    },
    opencode: {
      binaryPath: 'opencode',
      portRange: [3002, 3010],
      commandTimeout: 60000,
    },
    concurrency: {
      allowMultiQQPerProject: false,
      rejectWhenBusy: false,
      abortOwnOnly: true,
    },
    log: {
      level: 'INFO',
    },
  };

  let sessions: SessionManager;
  let processes: ProcessManager;
  let napcat: MockNapCatService;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    sessions = new SessionManager();
    processes = new ProcessManager([3002, 3010]);
    napcat = new MockNapCatService(config);
    handlers = new BridgeHandlers(config, sessions, processes, napcat);
  });

  function createMockOpenCodeServer() {
    let sseRes: ServerResponse | null = null;
    let sseReadyResolve!: () => void;
    const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

    let messageReadyResolve!: () => void;
    const messageReady = new Promise<void>((r) => { messageReadyResolve = r; });

    const permissionCalls: Array<{ sessionId: string; permissionId: string; body: string }> = [];

    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/event') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        sseRes = res;
        req.on('close', () => { sseRes = null; });
        sseReadyResolve();
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/message$/)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ parts: [] }));
        messageReadyResolve();
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          const match = req.url!.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/);
          permissionCalls.push({ sessionId: match![1], permissionId: match![2], body });
          res.writeHead(204);
          res.end();
        });
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/abort$/)) {
        res.writeHead(204);
        res.end();
        if (sseRes && !sseRes.writableEnded) {
          sseRes.end();
        }
        return;
      }

      if (req.method === 'GET' && req.url === '/config/providers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ providers: [], default: {} }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    function sendSSE(event: object) {
      if (sseRes && !sseRes.writableEnded) {
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }

    return { server, sendSSE, sseReady, messageReady, permissionCalls };
  }

  async function waitForState(qq: string, state: SessionState, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (sessions.getOrCreate(qq).state === state) return;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`Timed out waiting for state '${state}', current: '${sessions.getOrCreate(qq).state}'`);
  }

  function getLastReplyText(): string {
    const last = napcat.messages.at(-1);
    if (!last) return '';
    if (Array.isArray(last.message)) {
      const first = last.message[0] as { type: string; data: { text: string } } | undefined;
      return first?.data?.text ?? '';
    }
    return '';
  }

  it('handles permission request during run and allows approve', async () => {
    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'message.part.updated',
      properties: { sessionID: 'ses-1', part: { type: 'text', text: 'Working...' } },
    });
    await new Promise(r => setTimeout(r, 50));

    mock.sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-test', messageID: 'msg-1', sessionID: 'ses-1',
          title: 'Run: rm -rf /', type: 'bash', metadata: {},
        },
      },
    });

    await waitForState('123', 'permission_pending');

    const permMsg = napcat.messages.find(m => {
      const text = Array.isArray(m.message) ? (m.message[0] as { data: { text: string } })?.data?.text : '';
      return text?.includes('权限请求');
    });
    expect(permMsg).toBeDefined();

    await handlers.handlePermission('123', true, false);

    expect(mock.permissionCalls.length).toBe(1);
    expect(mock.permissionCalls[0].permissionId).toBe('perm-test');
    const body = JSON.parse(mock.permissionCalls[0].body);
    expect(body.response).toBe('once');

    const approveMsg = getLastReplyText();
    expect(approveMsg).toContain('已授权');

    expect(sessions.getOrCreate('123').state).toBe('running');

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    expect(sessions.getOrCreate('123').state).toBe('idle');

    mock.server.close();
  });

  it('handles permission request during run and allows reject', async () => {
    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-reject', messageID: 'msg-1', sessionID: 'ses-1',
          title: 'Run: dangerous cmd', type: 'bash', metadata: {},
        },
      },
    });

    await waitForState('123', 'permission_pending');

    await handlers.handlePermission('123', false, false);

    expect(mock.permissionCalls.length).toBe(1);
    const body = JSON.parse(mock.permissionCalls[0].body);
    expect(body.response).toBe('reject');

    const rejectMsg = getLastReplyText();
    expect(rejectMsg).toContain('已拒绝');

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    mock.server.close();
  });

  it('auto-approves matched permission patterns without user interaction', async () => {
    const configWithRules: Config = {
      ...config,
      permissions: {
        autoApprovePatterns: [{ pattern: 'bash:Run: git *', response: 'once' }],
        defaultAction: 'ask',
      },
    };

    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    const localSessions = new SessionManager();
    const localProcesses = new ProcessManager([3002, 3010]);
    const localNapcat = new MockNapCatService(configWithRules);
    const localHandlers = new BridgeHandlers(configWithRules, localSessions, localProcesses, localNapcat);

    localSessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = localHandlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-auto', messageID: 'msg-1', sessionID: 'ses-1',
          title: 'Run: git status', type: 'bash', metadata: {},
        },
      },
    });

    await new Promise(r => setTimeout(r, 100));

    expect(mock.permissionCalls.length).toBe(1);
    expect(mock.permissionCalls[0].permissionId).toBe('perm-auto');
    const body = JSON.parse(mock.permissionCalls[0].body);
    expect(body.response).toBe('once');

    const permMsg = localNapcat.messages.find(m => {
      const text = Array.isArray(m.message) ? (m.message[0] as { data: { text: string } })?.data?.text : '';
      return text?.includes('权限请求');
    });
    expect(permMsg).toBeUndefined();

    expect(localSessions.getOrCreate('123').state).toBe('running');

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    mock.server.close();
  });

  it('aborts during permission_pending state', async () => {
    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-abort', messageID: 'msg-1', sessionID: 'ses-1',
          title: 'Run: dangerous', type: 'bash', metadata: {},
        },
      },
    });

    await waitForState('123', 'permission_pending');

    await handlers.handleAbort('123', false);

    expect(sessions.getOrCreate('123').state).toBe('idle');
    expect(sessions.getOrCreate('123').pendingPermissionId).toBeNull();

    const abortMsg = getLastReplyText();
    expect(abortMsg).toContain('已中断');

    try { await runPromise; } catch { /* expected after abort */ }
    mock.server.close();
  });

  it('handles permission.asked event (V2) and allows approve', async () => {
    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'message.part.updated',
      properties: { sessionID: 'ses-1', part: { type: 'text', text: 'Working...' } },
    });
    await new Promise(r => setTimeout(r, 50));

    mock.sendSSE({
      type: 'permission.asked',
      properties: {
        sessionID: 'ses-1',
        id: 'perm-v2-approve',
        permission: 'bash',
        patterns: ['Run command: rm -rf /'],
        metadata: {},
        always: [],
      },
    });

    await waitForState('123', 'permission_pending');

    const permMsg = napcat.messages.find(m => {
      const text = Array.isArray(m.message) ? (m.message[0] as { data: { text: string } })?.data?.text : '';
      return text?.includes('权限请求');
    });
    expect(permMsg).toBeDefined();

    await handlers.handlePermission('123', true, false);

    expect(mock.permissionCalls.length).toBe(1);
    expect(mock.permissionCalls[0].permissionId).toBe('perm-v2-approve');
    const body = JSON.parse(mock.permissionCalls[0].body);
    expect(body.response).toBe('once');

    const approveMsg = getLastReplyText();
    expect(approveMsg).toContain('已授权');

    expect(sessions.getOrCreate('123').state).toBe('running');

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    expect(sessions.getOrCreate('123').state).toBe('idle');

    mock.server.close();
  });

  it('handles permission.asked event (V2) and allows reject', async () => {
    const mock = createMockOpenCodeServer();
    mock.server.listen(0, '127.0.0.1');
    await once(mock.server, 'listening');
    const port = (mock.server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'permission.asked',
      properties: {
        sessionID: 'ses-1',
        id: 'perm-v2-reject',
        permission: 'bash',
        patterns: ['Run command: dangerous cmd'],
        metadata: {},
        always: [],
      },
    });

    await waitForState('123', 'permission_pending');

    await handlers.handlePermission('123', false, false);

    expect(mock.permissionCalls.length).toBe(1);
    const body = JSON.parse(mock.permissionCalls[0].body);
    expect(body.response).toBe('reject');

    const rejectMsg = getLastReplyText();
    expect(rejectMsg).toContain('已拒绝');

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    mock.server.close();
  });
});
