import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config.js';
import type { Config } from '../src/types.js';

describe('validateConfig', () => {
  it('accepts valid config', () => {
    const config: Config = {
      whitelist: ['123456'],
      workspaceRoot: '/home/wtp/workspace',
      napcat: {
        wsUrl: 'ws://localhost:3001',
        httpUrl: 'http://localhost:3000',
        botQQ: '1111111111',
      },
      opencode: {
        binaryPath: '/usr/bin/opencode',
        portRange: [3002, 3999],
        commandTimeout: 300000,
      },
      concurrency: {
        allowMultiQQPerProject: true,
        rejectWhenBusy: true,
        abortOwnOnly: true,
      },
      log: { level: 'INFO' },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('rejects config missing required fields', () => {
    const partial = { whitelist: [] } as Config;
    expect(() => validateConfig(partial)).toThrow();
  });

  it('rejects invalid port range', () => {
    const config: Config = {
      whitelist: ['123'],
      workspaceRoot: '/tmp',
      napcat: { wsUrl: 'ws://localhost:3001', httpUrl: 'http://localhost:3000', botQQ: '1' },
      opencode: { binaryPath: '/bin/opencode', portRange: [4000, 3000], commandTimeout: 1000 },
      concurrency: { allowMultiQQPerProject: false, rejectWhenBusy: true, abortOwnOnly: true },
      log: { level: 'INFO' },
    };
    expect(() => validateConfig(config)).toThrow('portRange');
  });
});
