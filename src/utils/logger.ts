import type { Config } from '../types.js';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type Level = keyof typeof LEVELS;

let currentLevel: number = LEVELS.INFO;

export function initLogger(config: Config) {
  currentLevel = LEVELS[config.log.level as Level] ?? LEVELS.INFO;
}

export function debug(msg: string, ...args: unknown[]) {
  if (currentLevel <= LEVELS.DEBUG) log('DEBUG', msg, args);
}
export function info(msg: string, ...args: unknown[]) {
  if (currentLevel <= LEVELS.INFO) log('INFO', msg, args);
}
export function warn(msg: string, ...args: unknown[]) {
  if (currentLevel <= LEVELS.WARN) log('WARN', msg, args);
}
export function error(msg: string, ...args: unknown[]) {
  if (currentLevel <= LEVELS.ERROR) log('ERROR', msg, args);
}

function formatLocalTimestamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ms = pad(date.getMilliseconds(), 3);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`;
}

function log(level: string, msg: string, args: unknown[]) {
  const ts = formatLocalTimestamp(new Date());
  const extra = args.length > 0 ? ' ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') : '';
  process.stdout.write(`[${ts}] [${level}] ${msg}${extra}\n`);
}
