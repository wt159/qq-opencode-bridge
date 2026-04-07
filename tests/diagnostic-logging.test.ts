import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'http';
import { once } from 'events';
import { BridgeHandlers } from '../src/modules/handlers.js';
import { ProcessManager } from '../src/modules/process.js';
import { SessionManager } from '../src/modules/session.js';
import { OpenCodeClient, type OpenCodeEvent } from '../src/services/opencode.js';
import { NapCatService } from '../src/services/napcat.js';
import { initLogger } from '../src/utils/logger.js';
import type { Config } from '../src/types.js';

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

const debugConfig: Config = {
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
  log: { level: 'DEBUG' },
};

async function startOnRandomPort(server: import('http').Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

describe('diagnostic logging', () => {
  let logLines: string[] = [];
  let stdoutSpy: { mockRestore(): void };

  beforeEach(() => {
    initLogger(debugConfig);
    logLines = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      logLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('logs request start and failure context when sendMessage disconnects', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/session/ses-1/message') {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.destroy(new Error('socket closed'));
          }
        }, 50);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const port = await startOnRandomPort(server);
    const client = new OpenCodeClient(port);

    await expect(client.sendMessage('ses-1', 'hello world')).rejects.toThrow();

    const output = logLines.join('');
    expect(output).toContain('OpenCode request start');
    expect(output).toContain('OpenCode request failed');
    expect(output).toContain('method');
    expect(output).toContain('/session/ses-1/message');

    server.closeAllConnections();
    server.close();
  });

  it('logs SSE connection and permission request while sendMessage is still pending', async () => {
    let sseRes: ServerResponse | null = null;
    let sseReadyResolve!: () => void;
    const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });
    let postArrivedResolve!: () => void;
    const postArrived = new Promise<void>((r) => { postArrivedResolve = r; });

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

      if (req.method === 'GET' && req.url === '/config/providers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ providers: [], default: {} }));
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const port = await startOnRandomPort(server);
    const sessions = new SessionManager();
    const processes = new ProcessManager([3002, 3010]);
    const napcat = new MockNapCatService(debugConfig);
    const handlers = new BridgeHandlers(debugConfig, sessions, processes, napcat);

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'complex requirement', false);

    await Promise.all([sseReady, postArrived]);

    const sendSSE = (event: object) => {
      if (sseRes && !sseRes.writableEnded) {
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    sendSSE({
      type: 'permission.updated',
      properties: {
        sessionID: 'ses-1',
        permission: {
          id: 'perm-log',
          messageID: 'msg-1',
          sessionID: 'ses-1',
          title: 'Run command: ls',
          type: 'bash',
          metadata: {},
        },
      },
    });

    await new Promise(r => setTimeout(r, 150));

    const output = logLines.join('');
    expect(output).toContain('OpenCode SSE connect start');
    expect(output).toContain('OpenCode SSE connected');
    expect(output).toContain('handleRun sendMessage start');
    expect(output).toContain('Permission request received');

    server.closeAllConnections();
    server.close();
    await Promise.race([
      runPromise.catch(() => {}),
      new Promise(r => setTimeout(r, 1000)),
    ]);
  }, 10000);

  it('logs permission.asked event (V2) correctly', async () => {
    let sseRes: ServerResponse | null = null;
    let sseReadyResolve!: () => void;
    const sseReady = new Promise<void>((r) => { sseReadyResolve = r; });
    let postArrivedResolve!: () => void;
    const postArrived = new Promise<void>((r) => { postArrivedResolve = r; });

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

      if (req.method === 'GET' && req.url === '/config/providers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ providers: [], default: {} }));
        return;
      }

      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)) {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const port = await startOnRandomPort(server);
    const sessions = new SessionManager();
    const processes = new ProcessManager([3002, 3010]);
    const napcat = new MockNapCatService(debugConfig);
    const handlers = new BridgeHandlers(debugConfig, sessions, processes, napcat);

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');

    const runPromise = handlers.handleRun('123', 'complex requirement', false);

    await Promise.all([sseReady, postArrived]);

    const sendSSE = (event: object) => {
      if (sseRes && !sseRes.writableEnded) {
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    const event = {
      type: 'permission.asked',
      properties: {
        sessionID: 'ses-1',
        id: 'perm-v2',
        permission: 'external_directory',
        patterns: ['/home/wtp/*'],
        metadata: {},
        always: [],
      },
    } as unknown as OpenCodeEvent;

    sendSSE(event);

    await new Promise(r => setTimeout(r, 150));

    const output = logLines.join('');
    expect(output).toContain('OpenCode SSE connect start');
    expect(output).toContain('OpenCode SSE connected');
    expect(output).toContain('handleRun sendMessage start');
    expect(output).toContain('Permission request received');

    // Verify metadata includes sourceEvent and permissionType
    expect(output).toContain('"sourceEvent":"permission.asked"');
    expect(output).toContain('"permissionType":"external_directory"');

    server.closeAllConnections();
    server.close();
    await Promise.race([
      runPromise.catch(() => {}),
      new Promise(r => setTimeout(r, 1000)),
    ]);
  }, 10000);
});
