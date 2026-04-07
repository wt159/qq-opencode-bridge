import { beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'http';
import { once } from 'events';
import { BridgeHandlers } from '../src/modules/handlers.js';
import { ProcessManager } from '../src/modules/process.js';
import { SessionManager } from '../src/modules/session.js';
import type { Config } from '../src/types.js';
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

const POST_TIMEOUT_MS = 2000;

function createSlowPostMockServer() {
  let sseRes: ServerResponse | null = null;
  let sseReadyResolve!: () => void;
  const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

  let messagePostResResolve!: () => void;
  const messagePostResReady = new Promise<void>((r) => { messagePostResResolve = r; });

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
      messagePostResResolve();
      return;
    }

    if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
      res.writeHead(204);
      res.end();
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

  return { server, sendSSE, sseReady, messagePostResReady };
}

function createTimeoutPostMockServer(timeoutMs: number) {
  let sseRes: ServerResponse | null = null;
  let sseReadyResolve!: () => void;
  const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

  let messagePostResResolve!: () => void;
  const messagePostResReady = new Promise<void>((r) => { messagePostResResolve = r; });

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
      messagePostResResolve();
      setTimeout(() => {
        if (!res.writableEnded) {
          res.destroy();
        }
      }, timeoutMs);
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

  return { server, sseReady, messagePostResReady };
}

function createImmediatePostMockServer() {
  let sseRes: ServerResponse | null = null;
  let sseReadyResolve!: () => void;
  const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

  let messageReadyResolve!: () => void;
  const messageReady = new Promise<void>((r) => { messageReadyResolve = r; });

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
      res.writeHead(204);
      res.end();
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

  return { server, sendSSE, sseReady, messageReady };
}

const baseConfig: Config = {
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
  log: { level: 'INFO' },
};

function hasPermissionNotice(messages: MockNapCatService['messages']): boolean {
  return messages.some(m => {
    const text = Array.isArray(m.message)
      ? (m.message[0] as { data: { text: string } })?.data?.text
      : '';
    return text?.includes('权限请求');
  });
}

function getLastReplyText(messages: MockNapCatService['messages']): string {
  const last = messages.at(-1);
  if (!last) return '';
  if (Array.isArray(last.message)) {
    const first = last.message[0] as { type: string; data: { text: string } } | undefined;
    return first?.data?.text ?? '';
  }
  return '';
}

async function startOnRandomPort(server: import('http').Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

describe('handleRun: slow sendMessage POST blocks SSE event processing', () => {
  let sessions: SessionManager;
  let processes: ProcessManager;
  let napcat: MockNapCatService;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    sessions = new SessionManager();
    processes = new ProcessManager([3002, 3010]);
    napcat = new MockNapCatService(baseConfig);
    handlers = new BridgeHandlers(baseConfig, sessions, processes, napcat);
  });

  it('receives SSE permission event even when sendMessage POST is pending', async () => {
    let postArrivedResolve!: () => void;
    const postArrived = new Promise<void>((r) => { postArrivedResolve = r; });

    let sseRes: ServerResponse | null = null;
    let sseReadyResolve!: () => void;
    const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

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
        postArrivedResolve();
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/permission\/[^/]+\/reply$/)) {
        res.writeHead(204);
        res.end();
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

    const port = await startOnRandomPort(server);

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'complex task that takes time', false);

    await Promise.all([sseReady, postArrived]);
    await new Promise(r => setTimeout(r, 100));

    sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-slow',
          messageID: 'msg-1',
          sessionID: 'ses-1',
          title: 'Run command: complex operation',
          type: 'bash',
          metadata: {},
        },
      },
    });

    await new Promise(r => setTimeout(r, 300));

    expect(hasPermissionNotice(napcat.messages)).toBe(true);
    expect(sessions.getOrCreate('123').state).toBe('permission_pending');

    server.closeAllConnections();
    server.close();
    await Promise.race([
      runPromise.catch(() => {}),
      new Promise(r => setTimeout(r, 2000)),
    ]);
    }, 10000);

    it('receives SSE permission.asked event (V2) even when sendMessage POST is pending', async () => {
      let postArrivedResolve!: () => void;
      const postArrived = new Promise<void>((r) => { postArrivedResolve = r; });

      let sseRes: ServerResponse | null = null;
      let sseReadyResolve!: () => void;
      const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

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
          postArrivedResolve();
          return;
        }

        if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
          res.writeHead(204);
          res.end();
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

      const port = await startOnRandomPort(server);

      sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

      const runPromise = handlers.handleRun('123', 'complex task that takes time', false);

      await Promise.all([sseReady, postArrived]);
      await new Promise(r => setTimeout(r, 100));

      sendSSE({
        type: 'permission.asked',
        properties: {
          sessionID: 'ses-1',
          id: 'perm-slow',
          permission: 'bash',
          patterns: ['/tmp/slow-test'],
          metadata: {},
          always: [],
        },
      });

      await new Promise(r => setTimeout(r, 300));

      expect(hasPermissionNotice(napcat.messages)).toBe(true);
      expect(sessions.getOrCreate('123').state).toBe('permission_pending');

      // Approve the permission
      await handlers.handlePermission('123', true, false);

      // Resolve the pending POST
      postArrivedResolve();

      // Wait for session to become idle
      await new Promise(r => setTimeout(r, 100));

      // Send session.idle event
      sendSSE({
        type: 'session.idle',
        properties: { sessionID: 'ses-1' },
      });

      await runPromise;
      server.close();
    }, 10000);

    it('reports execution failure when POST /message times out', async () => {
    const mock = createTimeoutPostMockServer(POST_TIMEOUT_MS);
    const port = await startOnRandomPort(mock.server);

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'complex task', false);

    await mock.messagePostResReady;

    await new Promise(r => setTimeout(r, POST_TIMEOUT_MS + 500));

    expect(getLastReplyText(napcat.messages)).toContain('执行失败');
    expect(sessions.getOrCreate('123').state).toBe('idle');

    mock.server.closeAllConnections();
    mock.server.close();
    await Promise.race([
      runPromise.catch(() => {}),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  }, 10000);

  it('handles permission normally when POST returns immediately', async () => {
    const mock = createImmediatePostMockServer();
    const port = await startOnRandomPort(mock.server);

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'test task', false);

    await Promise.all([mock.sseReady, mock.messageReady]);

    mock.sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-normal',
          messageID: 'msg-1',
          sessionID: 'ses-1',
          title: 'Run: test',
          type: 'bash',
          metadata: {},
        },
      },
    });

    await new Promise(r => setTimeout(r, 100));

    expect(hasPermissionNotice(napcat.messages)).toBe(true);

    mock.sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;
    mock.server.close();
  });

  it('recovers result from SSE when POST hangs and SSE delivers completion', async () => {
    let sseRes: ServerResponse | null = null;
    let sseReadyResolve!: () => void;
    const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });

    let messagePostResResolve!: () => void;
    const messagePostResReady = new Promise<void>((r) => { messagePostResResolve = r; });

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
        // POST never responds — simulates long-running AI task (undici timeout scenario)
        messagePostResResolve();
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

    const port = await startOnRandomPort(server);
    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'complex task', false);

    await Promise.all([sseReady, messagePostResReady]);
    await new Promise(r => setTimeout(r, 100));

    // SSE delivers the result while POST is still hanging (simulating AI completing via SSE)
    sendSSE({
      type: 'message.part.updated',
      properties: { sessionID: 'ses-1', part: { type: 'text', text: 'Coverage: 68%' } },
    });

    await new Promise(r => setTimeout(r, 50));

    sendSSE({
      type: 'session.idle',
      properties: { sessionID: 'ses-1' },
    });

    await runPromise;

    // User should get the correct result from SSE, NOT a "fetch failed" error
    const lastReply = getLastReplyText(napcat.messages);
    expect(lastReply).toContain('Coverage: 68%');
    expect(lastReply).not.toContain('执行失败');
    expect(sessions.getOrCreate('123').state).toBe('idle');

    server.closeAllConnections();
    server.close();
  }, 10000);
});
