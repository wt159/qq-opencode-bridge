import { existsSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { BridgeError } from '../types.js';

export function listProjects(workspaceRoot: string): string[] {
  if (!existsSync(workspaceRoot)) return [];
  return readdirSync(workspaceRoot)
    .filter(name => {
      const fullPath = join(workspaceRoot, name);
      try { return statSync(fullPath).isDirectory(); } catch { return false; }
    });
}

export function createProject(workspaceRoot: string, name: string): string {
  const path = join(workspaceRoot, name);
  if (existsSync(path)) {
    throw new BridgeError('ERR_DIR_EXISTS', `目录已存在: ${path}`);
  }
  mkdirSync(path, { recursive: true });
  try {
    execSync('git init', { cwd: path, stdio: 'pipe' });
  } catch { /* git may not be installed */ }
  return path;
}

export function cloneProject(workspaceRoot: string, url: string, name: string): string {
  const path = join(workspaceRoot, name);
  if (existsSync(path)) {
    throw new BridgeError('ERR_DIR_EXISTS', `目录已存在: ${path}`);
  }
  if (!url.startsWith('https://')) {
    throw new BridgeError('ERR_INVALID_PATH', '克隆 URL 必须以 https:// 开头');
  }
  try {
    execSync(`git clone ${url} ${name}`, { cwd: workspaceRoot, stdio: 'pipe' });
  } catch {
    throw new BridgeError('ERR_GIT_CLONE_FAILED', `克隆失败: ${url}`);
  }
  return path;
}

export function createDirectory(basePath: string, relPath: string): string {
  const fullPath = join(basePath, relPath);
  if (existsSync(fullPath)) {
    throw new BridgeError('ERR_DIR_EXISTS', `目录已存在: ${fullPath}`);
  }
  mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

export function getDirectoryTree(rootPath: string, maxDepth = 3): string {
  if (!existsSync(rootPath)) return '目录不存在';
  return buildTree(rootPath, '', maxDepth);
}

function buildTree(dirPath: string, prefix: string, maxDepth: number, currentDepth = 0): string {
  if (currentDepth >= maxDepth) return '';
  const entries = readdirSync(dirPath).filter(n => !n.startsWith('.'));
  let result = '';
  entries.forEach((entry, i) => {
    const isLast = i === entries.length - 1;
    const fullPath = join(dirPath, entry);
    const isDir = statSync(fullPath).isDirectory();
    result += `${prefix}${isLast ? '└── ' : '├── '}${entry}${isDir ? '/' : ''}\n`;
    if (isDir) {
      result += buildTree(fullPath, prefix + (isLast ? '    ' : '│   '), maxDepth, currentDepth + 1);
    }
  });
  return result;
}
