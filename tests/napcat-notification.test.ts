import { describe, it, expect } from 'vitest';
import type { Config } from '../src/types.js';

describe('NapCatService notification config', () => {
  it('should allow notifyQQ in napcat config', () => {
    const config: Config = {
      whitelist: ['123456'],
      workspaceRoot: '/tmp/test',
      napcat: {
        wsUrl: 'ws://127.0.0.1:3000',
        httpUrl: 'http://127.0.0.1:3000',
        botQQ: '123456',
        notifyQQ: '987654321',
      },
      opencode: {
        binaryPath: '/usr/bin/opencode',
        portRange: [3001, 3999],
        commandTimeout: 300000,
      },
      concurrency: {
        allowMultiQQPerProject: false,
        rejectWhenBusy: false,
        abortOwnOnly: true,
      },
      log: { level: 'INFO' },
    };
    expect(config.napcat.notifyQQ).toBe('987654321');
  });

  it('should allow optional notifyQQ', () => {
    const config: Config = {
      whitelist: ['123456'],
      workspaceRoot: '/tmp/test',
      napcat: {
        wsUrl: 'ws://127.0.0.1:3000',
        httpUrl: 'http://127.0.0.1:3000',
        botQQ: '123456',
      },
      opencode: {
        binaryPath: '/usr/bin/opencode',
        portRange: [3001, 3999],
        commandTimeout: 300000,
      },
      concurrency: {
        allowMultiQQPerProject: false,
        rejectWhenBusy: false,
        abortOwnOnly: true,
      },
      log: { level: 'INFO' },
    };
    expect(config.napcat.notifyQQ).toBeUndefined();
  });
});
