import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listProjects, createProject, createDirectory, getDirectoryTree } from '../src/modules/filesystem.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('filesystem', () => {
  const testRoot = '/tmp/qq-bridge-test-fs';

  beforeEach(() => {
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(join(testRoot, 'proj-a'), { recursive: true });
    mkdirSync(join(testRoot, 'proj-b'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('lists directories under workspaceRoot', () => {
    const projects = listProjects(testRoot);
    expect(projects).toContain('proj-a');
    expect(projects).toContain('proj-b');
  });

  it('creates a new project', () => {
    const path = createProject(testRoot, 'new-proj');
    expect(existsSync(path)).toBe(true);
  });

  it('creates a directory', () => {
    const path = createDirectory(testRoot, 'sub/dir');
    expect(existsSync(path)).toBe(true);
  });

  it('returns directory tree', () => {
    const tree = getDirectoryTree(testRoot, 1);
    expect(tree).toContain('proj-a');
    expect(tree).toContain('proj-b');
  });
});
