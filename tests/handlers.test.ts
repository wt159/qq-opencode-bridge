import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'http';
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
