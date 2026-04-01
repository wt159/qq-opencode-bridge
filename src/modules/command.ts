import type { NapCatMessageSegment, ParsedCommand } from '../types.js';

const BRIDGE_COMMANDS = new Set([
  'bind', 'unbind', 'status', 'list',
  'ls', 'new', 'mkdir', 'tree',
  'modes', 'commands',
  'run', 'abort',
  'approve', 'reject',
  'stop', 'stopall',
  'help',
]);

export function parseCommand(input: string): ParsedCommand | null {
  const match = input.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!match) return null;

  const [, cmd, args] = match;

  if (cmd === 'oc') {
    const ocArgs = args || '';
    const parts = ocArgs.trim().split(/\s+/);
    const ocCmd = parts[0] || 'help';
    const ocCmdArgs = parts.slice(1).join(' ');
    return { type: 'opencode', command: ocCmd, args: ocCmdArgs };
  }

  if (BRIDGE_COMMANDS.has(cmd)) {
    return { type: 'bridge', command: cmd, args: args || '' };
  }

  return null;
}

export function normalizeMessage(
  messageType: 'private' | 'group',
  segments: NapCatMessageSegment[],
  botQQ: string,
): string | null {
  if (messageType === 'private') {
    const text = segments.find(s => s.type === 'text')?.data?.text as string | undefined;
    const trimmed = text?.trim() || null;
    if (!trimmed?.startsWith('/')) return null;
    return trimmed;
  }

  if (messageType === 'group') {
    const atIdx = segments.findIndex(
      s => s.type === 'at' && s.data?.qq === botQQ,
    );
    if (atIdx === -1) return null;

    const text = segments.slice(atIdx + 1).find(s => s.type === 'text')?.data?.text as string | undefined;
    const trimmed = text?.trim() || null;
    if (!trimmed?.startsWith('/')) return null;
    return trimmed;
  }

  return null;
}
