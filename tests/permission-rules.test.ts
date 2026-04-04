import { describe, it, expect } from 'vitest';
import { PermissionRules } from '../src/modules/permission-rules.js';
import type { PermissionData } from '../src/types.js';

function makePerm(overrides: Partial<PermissionData> = {}): PermissionData {
  return {
    id: 'perm-1',
    messageID: 'msg-1',
    sessionID: 'ses-1',
    title: 'Run command: ls -la',
    type: 'bash',
    metadata: {},
    ...overrides,
  };
}

describe('PermissionRules', () => {
  it('returns null when no rules match and defaultAction is ask', () => {
    const rules = new PermissionRules([], 'ask');
    expect(rules.evaluate(makePerm())).toBeNull();
  });

  it('returns "once" when defaultAction is allow and no rules match', () => {
    const rules = new PermissionRules([], 'allow');
    expect(rules.evaluate(makePerm())).toBe('once');
  });

  it('returns "reject" when defaultAction is reject and no rules match', () => {
    const rules = new PermissionRules([], 'reject');
    expect(rules.evaluate(makePerm())).toBe('reject');
  });

  it('matches exact pattern against type:title', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:Run command: ls -la', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm())).toBe('once');
  });

  it('matches glob pattern against type:title', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:Run command: git *', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ title: 'Run command: git status' }))).toBe('once');
    expect(rules.evaluate(makePerm({ title: 'Run command: ls' }))).toBeNull();
  });

  it('matches wildcard pattern for read operations', () => {
    const rules = new PermissionRules(
      [{ pattern: 'read:*', response: 'always' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ type: 'read', title: 'Read file.ts' }))).toBe('always');
  });

  it('uses first-match-wins when multiple rules could match', () => {
    const rules = new PermissionRules([
      { pattern: 'bash:*', response: 'reject' },
      { pattern: 'bash:Run command: git *', response: 'once' },
    ], 'ask');
    expect(rules.evaluate(makePerm({ title: 'Run command: git status' }))).toBe('reject');
  });

  it('matches against permission.pattern field when present (string)', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:git *', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ pattern: 'bash:git status' }))).toBe('once');
  });

  it('matches against permission.pattern field when present (array)', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:git *', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ pattern: ['bash:git status', 'bash:git log'] }))).toBe('once');
  });

  it('returns null when no pattern in array matches', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:git *', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ pattern: ['bash:ls -la', 'bash:rm -rf'] }))).toBeNull();
  });

  it('prefers permission.pattern over type:title when both exist', () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:git *', response: 'once' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({
      type: 'bash',
      title: 'Run command: ls',
      pattern: 'bash:git status',
    }))).toBe('once');
  });

  it('returns "always" response when matched rule says always', () => {
    const rules = new PermissionRules(
      [{ pattern: 'read:*', response: 'always' }],
      'ask',
    );
    expect(rules.evaluate(makePerm({ type: 'read', title: 'anything' }))).toBe('always');
  });
});
