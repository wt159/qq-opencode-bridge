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
