import { describe, it, expect } from 'vitest';
import { isWhitelisted, validateProjectPath } from '../src/modules/whitelist.js';

describe('isWhitelisted', () => {
  const wl = ['123', '456'];
  it('returns true for whitelisted QQ', () => {
    expect(isWhitelisted('123', wl)).toBe(true);
  });
  it('returns false for non-whitelisted QQ', () => {
    expect(isWhitelisted('789', wl)).toBe(false);
  });
});

describe('validateProjectPath', () => {
  const root = '/home/wtp/workspace';
  it('accepts path under workspaceRoot', () => {
    expect(validateProjectPath('/home/wtp/workspace/project', root)).toBe('/home/wtp/workspace/project');
  });
  it('rejects path outside workspaceRoot', () => {
    expect(() => validateProjectPath('/etc/passwd', root)).toThrow();
  });
  it('rejects path with .. escape', () => {
    expect(() => validateProjectPath('/home/wtp/workspace/../../etc', root)).toThrow();
  });
});
