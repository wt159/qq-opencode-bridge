import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Config } from './types.js';

export function loadConfig(configPath: string): Config {
  const absolute = resolve(configPath);
  const raw = readFileSync(absolute, 'utf-8');
  const config = JSON.parse(raw) as Config;
  validateConfig(config);
  return config;
}

export function validateConfig(config: Config): void {
  if (!config.whitelist || !Array.isArray(config.whitelist)) {
    throw new Error('Config: whitelist must be an array');
  }
  if (!config.workspaceRoot || typeof config.workspaceRoot !== 'string') {
    throw new Error('Config: workspaceRoot must be a string');
  }
  if (!config.napcat?.wsUrl || !config.napcat?.httpUrl || !config.napcat?.botQQ) {
    throw new Error('Config: napcat.wsUrl, napcat.httpUrl, and napcat.botQQ are required');
  }
  if (!config.opencode?.binaryPath || !config.opencode?.portRange) {
    throw new Error('Config: opencode.binaryPath and opencode.portRange are required');
  }
  const [min, max] = config.opencode.portRange;
  if (min >= max) {
    throw new Error('Config: portRange min must be less than max');
  }
  if (!config.concurrency) {
    throw new Error('Config: concurrency is required');
  }
  if (!config.log?.level) {
    throw new Error('Config: log.level is required');
  }
}
