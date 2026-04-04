import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from 'http';
import { once } from 'events';
import { handleFreeText } from '../src/modules/message-router.js';
import { SessionManager } from '../src/modules/session.js';
import { NapCatService } from '../src/services/napcat.js';
import type { Config } from '../src/types.js';

class MockNapCatService extends NapCatService {
  messages: Array<{ qq: string; message: unknown[] }> = [];

  constructor(config: Config) {
    super(config);
  }

  override async sendPrivateMsg(qq: string, message: unknown[]): Promise<void> {
    this.messages.push({ qq, message });
  }
}

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

describe('handleFreeText', () => {
  let sessions: SessionManager;
  let napcat: MockNapCatService;

  beforeEach(() => {
    sessions = new SessionManager();
    napcat = new MockNapCatService(config);
  });

  it('forwards text to OpenCode when session is running', async () => {
    let receivedBody = '';
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url?.match(/^\/session\/[^/]+\/message$/)) {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          receivedBody = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ parts: [] }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    sessions.bindProject('123', '/workspace/proj', port, 'ses-1');
    sessions.setState('123', 'running');

    const result = await handleFreeText('123', 'hello opencode', sessions, napcat, config);

    expect(result).toBe(true);
    expect(napcat.messages.length).toBe(0);
    expect(receivedBody).toContain('hello opencode');

    server.close();
  });

  it('replies unknown command when session is idle', async () => {
    const result = await handleFreeText('123', 'hello', sessions, napcat, config);

    expect(result).toBe(false);
    expect(napcat.messages.length).toBe(1);
    expect(napcat.messages[0].message).toEqual([
      { type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } },
    ]);
  });

  it('replies unknown command when session is not bound', async () => {
    sessions.getOrCreate('123');

    const result = await handleFreeText('123', 'hello', sessions, napcat, config);

    expect(result).toBe(false);
    expect(napcat.messages.length).toBe(1);
  });

  it('handles forwarding failure gracefully without crashing', async () => {
    sessions.bindProject('123', '/workspace/proj', 59999, 'ses-1');
    sessions.setState('123', 'running');

    const result = await handleFreeText('123', 'hello', sessions, napcat, config);

    expect(result).toBe(true);
    expect(napcat.messages.length).toBe(0);
  });

  it('does not forward when session is permission_pending', async () => {
    sessions.bindProject('123', '/workspace/proj', 3002, 'ses-1');
    sessions.setState('123', 'permission_pending');

    const result = await handleFreeText('123', 'hello', sessions, napcat, config);

    expect(result).toBe(false);
    expect(napcat.messages.length).toBe(1);
  });
});
