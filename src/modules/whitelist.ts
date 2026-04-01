import { resolve } from 'path';
import { BridgeError } from '../types.js';

export function isWhitelisted(qq: string, whitelist: string[]): boolean {
  return whitelist.includes(qq);
}

export function validateProjectPath(projectPath: string, workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot, projectPath);
  if (!resolved.startsWith(resolve(workspaceRoot) + '/') && resolved !== resolve(workspaceRoot)) {
    throw new BridgeError('ERR_PATH_FORBIDDEN', `路径不在允许范围内: ${projectPath}`);
  }
  return resolved;
}
