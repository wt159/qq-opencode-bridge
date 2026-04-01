import { describe, it, expect } from 'vitest';
import { parseCommand, normalizeMessage } from '../src/modules/command.js';

describe('parseCommand', () => {
  it('parses bridge command', () => {
    const cmd = parseCommand('/bind /workspace/proj');
    expect(cmd).toEqual({ type: 'bridge', command: 'bind', args: '/workspace/proj' });
  });

  it('parses OpenCode command', () => {
    const cmd = parseCommand('/oc init-deep');
    expect(cmd).toEqual({ type: 'opencode', command: 'init-deep', args: '' });
  });

  it('parses OpenCode command with args', () => {
    const cmd = parseCommand('/oc mcp list');
    expect(cmd).toEqual({ type: 'opencode', command: 'mcp', args: 'list' });
  });

  it('returns null for unknown command', () => {
    expect(parseCommand('/foobar')).toBeNull();
  });

  it('returns null for non-command text', () => {
    expect(parseCommand('hello world')).toBeNull();
  });

  it('parses /oc with no args as help', () => {
    const cmd = parseCommand('/oc');
    expect(cmd).toEqual({ type: 'opencode', command: 'help', args: '' });
  });
});

describe('normalizeMessage', () => {
  it('extracts text from private message', () => {
    const msg = normalizeMessage('private', [
      { type: 'text', data: { text: '/run hello' } },
    ], '111');
    expect(msg).toBe('/run hello');
  });

  it('returns null for non-command private message', () => {
    const msg = normalizeMessage('private', [
      { type: 'text', data: { text: 'hello' } },
    ], '111');
    expect(msg).toBeNull();
  });

  it('extracts text after @Bot in group message', () => {
    const msg = normalizeMessage('group', [
      { type: 'at', data: { qq: '111' } },
      { type: 'text', data: { text: '/run hello' } },
    ], '111');
    expect(msg).toBe('/run hello');
  });

  it('returns null for group message without @Bot', () => {
    const msg = normalizeMessage('group', [
      { type: 'text', data: { text: '/run hello' } },
    ], '111');
    expect(msg).toBeNull();
  });
});
