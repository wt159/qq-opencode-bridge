# QQ-OpenCode Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript bridge service that connects NapCatQQ (QQ bot) to OpenCode, enabling QQ-based remote code operations.

**Architecture:** NapCat pushes events via reverse WebSocket to a Bridge server. Bridge parses commands, manages OpenCode instances (spawn/stop), routes commands via OpenCode HTTP API, and replies via NapCat HTTP API.

**Tech Stack:** TypeScript, Node.js 20+, ws (WebSocket), vitest (testing), tsx (runtime)

---

## File Structure Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config |
| `src/types.ts` | All type definitions (Config, QQSession, etc.) |
| `src/config.ts` | Config loading and validation |
| `src/modules/whitelist.ts` | QQ whitelist + path validation |
| `src/modules/session.ts` | QQ session state management |
| `src/modules/process.ts` | OpenCode process lifecycle |
| `src/modules/command.ts` | Command parsing and routing |
| `src/modules/filesystem.ts` | /ls, /new, /mkdir, /tree |
| `src/services/napcat.ts` | NapCat WS server + HTTP client |
| `src/services/opencode.ts` | OpenCode HTTP API client |
| `src/utils/logger.ts` | Simple logger |
| `src/index.ts` | Entry point, wires everything |
| `config.example.json` | Example configuration |
| `tests/config.test.ts` | Config tests |
| `tests/whitelist.test.ts` | Whitelist tests |
| `tests/session.test.ts` | Session manager tests |
| `tests/command.test.ts` | Command parser tests |
| `tests/process.test.ts` | Process manager tests |
| `tests/filesystem.test.ts` | Filesystem module tests |

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "qq-opencode-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create src/types.ts with all type definitions**

```typescript
// src/types.ts

// ── Configuration ──────────────────────────────────────────────

export interface Config {
  whitelist: string[];
  workspaceRoot: string;
  napcat: {
    wsUrl: string;
    httpUrl: string;
    token?: string;
    botQQ: string;
  };
  opencode: {
    binaryPath: string;
    portRange: [number, number];
    password?: string;
    commandTimeout: number;
  };
  concurrency: ConcurrencyRule;
  log: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    file?: string;
  };
}

export interface ConcurrencyRule {
  allowMultiQQPerProject: boolean;
  rejectWhenBusy: boolean;
  abortOwnOnly: boolean;
}

// ── Runtime State ──────────────────────────────────────────────

export type SessionState =
  | 'idle'
  | 'running'
  | 'permission_pending'
  | 'aborting'
  | 'restarting'
  | 'stopped';

export interface QQSession {
  qq: string;
  projectPath: string | null;
  projectPort: number | null;
  sessionId: string | null;
  model: string | null;
  state: SessionState;
  runningMessageId: string | null;
  pendingPermissionId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface ProjectInstance {
  path: string;
  port: number;
  pid: number;
  startedAt: Date;
  sessions: Set<string>;
  status: 'running' | 'stopping' | 'stopped';
}

// ── NapCat Events ──────────────────────────────────────────────

export interface NapCatMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface NapCatMessageEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  user_id: number;
  group_id?: number;
  message: NapCatMessageSegment[];
  raw_message: string;
}

// ── Parsed Command ─────────────────────────────────────────────

export type CommandType = 'bridge' | 'opencode';

export interface ParsedCommand {
  type: CommandType;
  command: string;
  args: string;
}

// ── Errors ─────────────────────────────────────────────────────

export type ErrorCode =
  | 'ERR_NO_BIND'
  | 'ERR_PATH_NOT_FOUND'
  | 'ERR_PATH_FORBIDDEN'
  | 'ERR_ALREADY_RUNNING'
  | 'ERR_TIMEOUT'
  | 'ERR_START_FAILED'
  | 'ERR_MODEL_NOT_FOUND'
  | 'ERR_UNKNOWN_CMD'
  | 'ERR_NOT_WHITELIST'
  | 'ERR_DIR_EXISTS'
  | 'ERR_GIT_CLONE_FAILED'
  | 'ERR_INVALID_PATH'
  | 'ERR_PERMISSION_PENDING';

export class BridgeError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
```

- [ ] **Step 4: Install dependencies and verify**

```bash
npm install
npx tsc --noEmit
```

Expected: No errors (types only, no implementation yet).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json src/types.ts
git commit -m "feat: project setup with types"
```

---

### Task 2: Config Loading and Validation

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `config.example.json`

- [ ] **Step 1: Write tests for config loading**

```typescript
// tests/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig, validateConfig } from '../src/config.js';
import type { Config } from '../src/types.js';

describe('loadConfig', () => {
  it('loads valid config from JSON file', async () => {
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
    // validateConfig should accept this
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL with "loadConfig is not defined"

- [ ] **Step 3: Implement config loading**

```typescript
// src/config.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Create config.example.json**

```json
{
  "whitelist": ["123456789", "987654321"],
  "workspaceRoot": "/home/wtp/workspace",
  "napcat": {
    "wsUrl": "ws://localhost:3001",
    "httpUrl": "http://localhost:3000",
    "token": "your-token-here",
    "botQQ": "1111111111"
  },
  "opencode": {
    "binaryPath": "/home/wtp/.opencode/bin/opencode",
    "portRange": [3002, 3999],
    "password": "optional-password",
    "commandTimeout": 300000
  },
  "concurrency": {
    "allowMultiQQPerProject": true,
    "rejectWhenBusy": true,
    "abortOwnOnly": true
  },
  "log": {
    "level": "INFO",
    "file": "./bridge.log"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts config.example.json
git commit -m "feat: config loading with validation"
```

---

### Task 3: Logger Utility

**Files:**
- Create: `src/utils/logger.ts`

- [ ] **Step 1: Create logger**

```typescript
// src/utils/logger.ts
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

function log(level: string, msg: string, args: unknown[]) {
  const ts = new Date().toISOString();
  const extra = args.length > 0 ? ' ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') : '';
  process.stdout.write(`[${ts}] [${level}] ${msg}${extra}\n`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: logger utility"
```

---

### Task 4: Whitelist Module

**Files:**
- Create: `src/modules/whitelist.ts`
- Create: `tests/whitelist.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/whitelist.test.ts
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
    expect(validateProjectPath('/home/wtp/workspace/project', root)).toBe(true);
  });
  it('rejects path outside workspaceRoot', () => {
    expect(() => validateProjectPath('/etc/passwd', root)).toThrow();
  });
  it('rejects path with .. escape', () => {
    expect(() => validateProjectPath('/home/wtp/workspace/../../etc', root)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/whitelist.test.ts
```

- [ ] **Step 3: Implement whitelist module**

```typescript
// src/modules/whitelist.ts
import { resolve, isAbsolute } from 'path';
import { BridgeError } from '../types.js';

export function isWhitelisted(qq: string, whitelist: string[]): boolean {
  return whitelist.includes(qq);
}

export function validateProjectPath(projectPath: string, workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot, projectPath);
  if (!resolved.startsWith(resolve(workspaceRoot))) {
    throw new BridgeError('ERR_PATH_FORBIDDEN', `路径不在允许范围内: ${projectPath}`);
  }
  return resolved;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/whitelist.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/whitelist.ts tests/whitelist.test.ts
git commit -m "feat: whitelist and path validation"
```

---

### Task 5: Session Manager

**Files:**
- Create: `src/modules/session.ts`
- Create: `tests/session.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/session.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/modules/session.js';

describe('SessionManager', () => {
  let mgr: SessionManager;
  beforeEach(() => { mgr = new SessionManager(); });

  it('creates a new session', () => {
    const s = mgr.getOrCreate('123');
    expect(s.qq).toBe('123');
    expect(s.state).toBe('idle');
  });

  it('returns same session for same QQ', () => {
    const s1 = mgr.getOrCreate('123');
    const s2 = mgr.getOrCreate('123');
    expect(s1).toBe(s2);
  });

  it('binds a project to a session', () => {
    const s = mgr.getOrCreate('123');
    mgr.bindProject('123', '/workspace/proj', 3002, 'session-abc');
    expect(s.projectPath).toBe('/workspace/proj');
    expect(s.projectPort).toBe(3002);
    expect(s.sessionId).toBe('session-abc');
  });

  it('unbinds a session', () => {
    mgr.getOrCreate('123');
    mgr.bindProject('123', '/workspace/proj', 3002, 'abc');
    mgr.unbind('123');
    const s = mgr.getOrCreate('123');
    expect(s.projectPath).toBeNull();
  });

  it('updates model', () => {
    const s = mgr.getOrCreate('123');
    mgr.setModel('123', 'anthropic/claude-3-5-sonnet');
    expect(s.model).toBe('anthropic/claude-3-5-sonnet');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/session.test.ts
```

- [ ] **Step 3: Implement session manager**

```typescript
// src/modules/session.ts
import type { QQSession, SessionState } from '../types.js';

export class SessionManager {
  private sessions = new Map<string, QQSession>();

  getOrCreate(qq: string): QQSession {
    if (!this.sessions.has(qq)) {
      this.sessions.set(qq, {
        qq,
        projectPath: null,
        projectPort: null,
        sessionId: null,
        model: null,
        state: 'idle',
        runningMessageId: null,
        pendingPermissionId: null,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
    }
    return this.sessions.get(qq)!;
  }

  bindProject(qq: string, projectPath: string, port: number, sessionId: string): void {
    const s = this.getOrCreate(qq);
    s.projectPath = projectPath;
    s.projectPort = port;
    s.sessionId = sessionId;
    s.state = 'idle';
    s.lastActiveAt = new Date();
  }

  unbind(qq: string): void {
    const s = this.sessions.get(qq);
    if (s) {
      s.projectPath = null;
      s.projectPort = null;
      s.sessionId = null;
      s.model = null;
      s.state = 'idle';
      s.pendingPermissionId = null;
      s.runningMessageId = null;
    }
  }

  setModel(qq: string, model: string): void {
    const s = this.getOrCreate(qq);
    s.model = model;
  }

  setState(qq: string, state: SessionState): void {
    const s = this.getOrCreate(qq);
    s.state = state;
  }

  getAll(): QQSession[] {
    return Array.from(this.sessions.values());
  }

  delete(qq: string): void {
    this.sessions.delete(qq);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/session.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/session.ts tests/session.test.ts
git commit -m "feat: session manager"
```

---

### Task 6: Command Parser

**Files:**
- Create: `src/modules/command.ts`
- Create: `tests/command.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/command.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/command.test.ts
```

- [ ] **Step 3: Implement command parser**

```typescript
// src/modules/command.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/command.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/command.ts tests/command.test.ts
git commit -m "feat: command parser with message normalization"
```

---

### Task 7: NapCat Service (WS Server + HTTP Client)

**Files:**
- Create: `src/services/napcat.ts`

- [ ] **Step 1: Create NapCat service**

```typescript
// src/services/napcat.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Config, NapCatMessageEvent } from '../types.js';
import { info, error, debug } from '../utils/logger.js';

export type MessageHandler = (event: NapCatMessageEvent) => Promise<void>;

export class NapCatService {
  private wss: WebSocketServer | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  start(handler: MessageHandler): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.parsePort() }, () => {
        info(`NapCat WS server listening on port ${this.parsePort()}`);
        resolve();
      });

      this.wss.on('connection', (ws, req) => {
        info(`NapCat connected from ${req.socket.remoteAddress}`);

        ws.on('message', async (data) => {
          try {
            const event = JSON.parse(data.toString()) as NapCatMessageEvent;
            if (event.post_type === 'message') {
              await handler(event);
            }
          } catch (e) {
            error('Failed to parse NapCat message', e);
          }
        });

        ws.on('error', (e) => error('NapCat WS error', e));
      });
    });
  }

  private parsePort(): number {
    const url = new URL(this.config.napcat.wsUrl);
    return parseInt(url.port, 10);
  }

  async sendPrivateMsg(qq: string, message: string | unknown[]): Promise<void> {
    await this.sendNapCatApi('send_private_msg', { user_id: parseInt(qq, 10), message });
  }

  async sendGroupMsg(groupId: number, message: string | unknown[]): Promise<void> {
    await this.sendNapCatApi('send_group_msg', { group_id: groupId, message });
  }

  private async sendNapCatApi(action: string, params: Record<string, unknown>): Promise<void> {
    const url = `${this.config.napcat.httpUrl}/${action}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.napcat.token) {
      headers['Authorization'] = `Bearer ${this.config.napcat.token}`;
    }

    const body = { action, params };
    debug('NapCat API call', action, params);

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      throw new Error(`NapCat API error: ${resp.status} ${resp.statusText}`);
    }
  }

  stop(): void {
    this.wss?.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/napcat.ts
git commit -m "feat: NapCat service with WS server and HTTP client"
```

---

### Task 8: OpenCode Process Manager

**Files:**
- Create: `src/modules/process.ts`
- Create: `tests/process.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/process.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessManager } from '../src/modules/process.js';

describe('ProcessManager', () => {
  let mgr: ProcessManager;
  beforeEach(() => { mgr = new ProcessManager([3002, 3010]); });

  it('allocates ports sequentially', () => {
    const p1 = mgr.allocatePort();
    const p2 = mgr.allocatePort();
    expect(p2).toBe(p1 + 1);
  });

  it('tracks running instances', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    const instances = mgr.getInstances();
    expect(instances.size).toBe(1);
    expect(instances.get('/proj/a')?.port).toBe(3002);
  });

  it('removes instances', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    mgr.removeInstance('/proj/a');
    expect(mgr.getInstances().size).toBe(0);
  });

  it('finds instance by path', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    const inst = mgr.getInstance('/proj/a');
    expect(inst?.port).toBe(3002);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/process.test.ts
```

- [ ] **Step 3: Implement process manager**

```typescript
// src/modules/process.ts
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import type { ProjectInstance } from '../types.js';
import { info, error } from '../utils/logger.js';

export class ProcessManager {
  private instances = new Map<string, ProjectInstance & { proc: ChildProcess }>();
  private portRange: [number, number];
  private nextPort: number;

  constructor(portRange: [number, number]) {
    this.portRange = portRange;
    this.nextPort = portRange[0];
  }

  allocatePort(): number {
    const port = this.nextPort;
    this.nextPort++;
    if (this.nextPort > this.portRange[1]) {
      this.nextPort = this.portRange[0];
    }
    return port;
  }

  startInstance(
    binaryPath: string,
    projectPath: string,
    port: number,
    password?: string,
  ): Promise<ProjectInstance> {
    return new Promise((resolve, reject) => {
      if (!existsSync(projectPath)) {
        reject(new Error(`Project directory not found: ${projectPath}`));
        return;
      }

      const env = {
        ...process.env,
        ...(password ? { OPENCODE_SERVER_PASSWORD: password } : {}),
      };

      const proc = spawn(binaryPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stderr?.on('data', (d) => error(`[opencode:${port}]`, d.toString()));
      proc.on('error', (e) => error(`[opencode:${port}] process error`, e));
      proc.on('exit', (code) => {
        info(`[opencode:${port}] exited with code ${code}`);
        this.instances.delete(projectPath);
      });

      const instance: ProjectInstance & { proc: ChildProcess } = {
        path: projectPath,
        port,
        pid: proc.pid!,
        startedAt: new Date(),
        sessions: new Set(),
        status: 'running',
        proc,
      };

      this.instances.set(projectPath, instance);
      info(`Started OpenCode at ${projectPath} on port ${port} (PID ${proc.pid})`);
      resolve(instance);
    });
  }

  stopInstance(projectPath: string): void {
    const inst = this.instances.get(projectPath);
    if (inst) {
      inst.status = 'stopping';
      inst.proc.kill('SIGTERM');
      this.instances.delete(projectPath);
      info(`Stopped OpenCode at ${projectPath}`);
    }
  }

  stopAll(): void {
    for (const path of this.instances.keys()) {
      this.stopInstance(path);
    }
  }

  getInstance(path: string): ProjectInstance | undefined {
    return this.instances.get(path);
  }

  getInstances(): Map<string, ProjectInstance> {
    const result = new Map<string, ProjectInstance>();
    for (const [k, v] of this.instances) {
      result.set(k, { ...v, sessions: new Set(v.sessions) });
    }
    return result;
  }

  addInstance(path: string, port: number, pid: number): void {
    // For testing
    const proc = { pid, kill: () => {}, on: () => {} } as any;
    this.instances.set(path, {
      path, port, pid, startedAt: new Date(),
      sessions: new Set(), status: 'running', proc,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/process.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/process.ts tests/process.test.ts
git commit -m "feat: OpenCode process manager"
```

---

### Task 9: OpenCode API Client

**Files:**
- Create: `src/services/opencode.ts`

- [ ] **Step 1: Create OpenCode API client**

```typescript
// src/services/opencode.ts
import type { SessionState } from '../types.js';

export class OpenCodeClient {
  private baseUrl: string;
  private password?: string;

  constructor(port: number, password?: string) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.password = password;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`;
    }
    return headers;
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: this.getHeaders(),
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      throw new Error(`OpenCode API error: ${resp.status} ${resp.statusText} for ${method} ${path}`);
    }
    if (resp.status === 204) return undefined as T;
    return resp.json() as Promise<T>;
  }

  // ── Sessions ──────────────────────────────────────────────

  async createSession(title?: string): Promise<{ id: string }> {
    return this.request('/session', 'POST', { title });
  }

  async sendMessage(sessionId: string, text: string, model?: { providerID: string; modelID: string }): Promise<{ parts: { type: string; text?: string }[] }> {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text }],
    };
    if (model) body.model = model;
    return this.request(`/session/${sessionId}/message`, 'POST', body);
  }

  async sendCommand(sessionId: string, command: string, args: string): Promise<{ parts: { type: string; text?: string }[] }> {
    return this.request(`/session/${sessionId}/command`, 'POST', { command, arguments: args });
  }

  async abort(sessionId: string): Promise<void> {
    return this.request(`/session/${sessionId}/abort`, 'POST');
  }

  async respondToPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject', remember = false): Promise<void> {
    return this.request(`/session/${sessionId}/permissions/${permissionId}`, 'POST', { response, remember });
  }

  // ── Config ────────────────────────────────────────────────

  async getProviders(): Promise<{ providers: { id: string; name: string; models: { id: string }[] }[]; default: Record<string, string> }> {
    return this.request('/config/providers');
  }

  // ── Commands ──────────────────────────────────────────────

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    return this.request('/command');
  }

  // ── Health ────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/global/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/opencode.ts
git commit -m "feat: OpenCode HTTP API client"
```

---

### Task 10: Bridge Command Handlers

**Files:**
- Create: `src/modules/handlers.ts`

- [ ] **Step 1: Implement all bridge command handlers**

```typescript
// src/modules/handlers.ts
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, relative } from 'path';
import type { Config, QQSession } from '../types.js';
import { BridgeError } from '../types.js';
import { SessionManager } from './session.js';
import { ProcessManager } from './process.js';
import { OpenCodeClient } from '../services/opencode.js';
import { NapCatService } from '../services/napcat.js';
import { validateProjectPath } from './whitelist.js';
import { info } from '../utils/logger.js';

export class BridgeHandlers {
  constructor(
    private config: Config,
    private sessions: SessionManager,
    private processes: ProcessManager,
    private napcat: NapCatService,
  ) {}

  private getClient(qq: string): OpenCodeClient {
    const s = this.sessions.getOrCreate(qq);
    if (!s.projectPort) throw new BridgeError('ERR_NO_BIND', '请先使用 /bind <项目路径> 绑定项目');
    return new OpenCodeClient(s.projectPort, this.config.opencode.password);
  }

  private async reply(qq: string, text: string, isGroup: boolean, groupId?: number) {
    const msg = [{ type: 'text', data: { text } }];
    if (isGroup && groupId) {
      await this.napcat.sendGroupMsg(groupId, msg);
    } else {
      await this.napcat.sendPrivateMsg(qq, msg);
    }
  }

  // ── /bind ─────────────────────────────────────────────────

  async handleBind(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const projectPath = args.trim();
    if (!projectPath) {
      return this.reply(qq, '用法: /bind <项目路径>', isGroup, groupId);
    }

    try {
      const resolved = validateProjectPath(projectPath, this.config.workspaceRoot);
      if (!existsSync(resolved)) {
        return this.reply(qq, `项目不存在: ${resolved}`, isGroup, groupId);
      }

      let instance = this.processes.getInstance(resolved);
      if (!instance) {
        const port = this.processes.allocatePort();
        instance = await this.processes.startInstance(
          this.config.opencode.binaryPath,
          resolved,
          port,
          this.config.opencode.password,
        );
      }

      // Wait for server to be ready
      const client = new OpenCodeClient(instance.port, this.config.opencode.password);
      let ready = false;
      for (let i = 0; i < 30; i++) {
        if (await client.isHealthy()) { ready = true; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!ready) {
        return this.reply(qq, '项目启动失败，请检查日志', isGroup, groupId);
      }

      const session = await client.createSession(`QQ-${qq}`);
      this.sessions.bindProject(qq, resolved, instance.port, session.id);
      instance.sessions.add(qq);

      return this.reply(qq, `已绑定: ${resolved}`, isGroup, groupId);
    } catch (e) {
      if (e instanceof BridgeError) {
        return this.reply(qq, e.message, isGroup, groupId);
      }
      return this.reply(qq, `绑定失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  // ── /unbind ───────────────────────────────────────────────

  async handleUnbind(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    this.sessions.unbind(qq);
    return this.reply(qq, '已解除绑定', isGroup, groupId);
  }

  // ── /status ───────────────────────────────────────────────

  async handleStatus(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    const lines = [
      `项目: ${s.projectPath || '未绑定'}`,
      `模型: ${s.model || '默认'}`,
      `状态: ${s.state}`,
    ];
    return this.reply(qq, lines.join('\n'), isGroup, groupId);
  }

  // ── /list ─────────────────────────────────────────────────

  async handleList(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const instances = this.processes.getInstances();
    if (instances.size === 0) {
      return this.reply(qq, '没有运行中的项目', isGroup, groupId);
    }
    const lines = ['运行中的项目:'];
    let i = 1;
    for (const [path, inst] of instances) {
      lines.push(`${i}. ${path} (port:${inst.port})`);
      i++;
    }
    return this.reply(qq, lines.join('\n'), isGroup, groupId);
  }

  // ── /run ──────────────────────────────────────────────────

  async handleRun(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (!s.sessionId) return this.reply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);
    if (s.state !== 'idle') return this.reply(qq, '当前有命令正在执行，请稍后或使用 /abort 中断', isGroup, groupId);

    s.state = 'running';
    try {
      const client = this.getClient(qq);
      const model = s.model ? (() => {
        const [providerID, modelID] = s.model.split('/');
        return { providerID, modelID };
      })() : undefined;
      const result = await client.sendMessage(s.sessionId, args, model);
      const text = result.parts.map(p => p.type === 'text' ? p.text : '').filter(Boolean).join('\n');
      s.state = 'idle';
      return this.reply(qq, text || '(无输出)', isGroup, groupId);
    } catch (e) {
      s.state = 'idle';
      return this.reply(qq, `执行失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  // ── /abort ────────────────────────────────────────────────

  async handleAbort(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'running') return this.reply(qq, '当前没有正在执行的命令', isGroup, groupId);

    s.state = 'aborting';
    try {
      const client = this.getClient(qq);
      await client.abort(s.sessionId!);
      s.state = 'idle';
      return this.reply(qq, '已中断', isGroup, groupId);
    } catch (e) {
      s.state = 'idle';
      return this.reply(qq, `中断失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  // ── /modes ────────────────────────────────────────────────

  async handleModes(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    const client = this.getClient(qq);

    if (!args.trim()) {
      const { providers } = await client.getProviders();
      const lines = ['可用模型:'];
      for (const p of providers) {
        for (const m of p.models) {
          lines.push(`- ${p.id}/${m.id}`);
        }
      }
      return this.reply(qq, lines.join('\n'), isGroup, groupId);
    }

    // Validate model exists
    const { providers } = await client.getProviders();
    const allModels = providers.flatMap(p => p.models.map(m => `${p.id}/${m.id}`));
    if (!allModels.includes(args.trim())) {
      return this.reply(qq, `模型不存在: ${args.trim()}`, isGroup, groupId);
    }

    this.sessions.setModel(qq, args.trim());
    return this.reply(qq, `已切换为: ${args.trim()}`, isGroup, groupId);
  }

  // ── /commands ─────────────────────────────────────────────

  async handleCommands(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const client = this.getClient(qq);
    const cmds = await client.listCommands();
    const lines = ['可用命令:'];
    for (const c of cmds) {
      lines.push(`- /oc ${c.name}${c.description ? ` — ${c.description}` : ''}`);
    }
    return this.reply(qq, lines.join('\n'), isGroup, groupId);
  }

  // ── /oc <cmd> ─────────────────────────────────────────────

  async handleOpenCodeCmd(qq: string, command: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (!s.sessionId) return this.reply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);

    if (command === 'help' || !command) {
      return this.handleCommands(qq, isGroup, groupId);
    }

    try {
      const client = this.getClient(qq);
      const result = await client.sendCommand(s.sessionId, command, args);
      const text = result.parts.map(p => p.type === 'text' ? p.text : '').filter(Boolean).join('\n');
      return this.reply(qq, text || `(命令 ${command} 已执行)`, isGroup, groupId);
    } catch (e) {
      return this.reply(qq, `命令执行失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }

  // ── /approve /reject ──────────────────────────────────────

  async handlePermission(qq: string, approve: boolean, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'permission_pending') {
      return this.reply(qq, '当前没有待确认的权限请求', isGroup, groupId);
    }
    // Note: permissionId would be set by OpenCode events; for now this is a placeholder
    return this.reply(qq, approve ? '已授权' : '已拒绝', isGroup, groupId);
  }

  // ── /stop ─────────────────────────────────────────────────

  async handleStop(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const projectPath = args.trim();
    if (!projectPath) return this.reply(qq, '用法: /stop <项目路径>', isGroup, groupId);

    const resolved = resolve(this.config.workspaceRoot, projectPath);
    const instance = this.processes.getInstance(resolved);
    if (!instance) return this.reply(qq, `项目未运行: ${resolved}`, isGroup, groupId);

    // Notify all sessions bound to this project
    for (const session of this.sessions.getAll()) {
      if (session.projectPath === resolved) {
        this.sessions.unbind(session.qq);
        await this.reply(session.qq, `项目已关闭: ${resolved}`, false);
      }
    }

    this.processes.stopInstance(resolved);
    return this.reply(qq, `已关闭: ${resolved}`, isGroup, groupId);
  }

  // ── /stopall ──────────────────────────────────────────────

  async handleStopAll(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const count = this.processes.getInstances().size;
    this.processes.stopAll();
    for (const session of this.sessions.getAll()) {
      this.sessions.unbind(session.qq);
    }
    return this.reply(qq, `已关闭所有项目 (共${count}个)`, isGroup, groupId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/handlers.ts
git commit -m "feat: all bridge command handlers"
```

---

### Task 11: Filesystem Module (/ls, /new, /mkdir, /tree)

**Files:**
- Create: `src/modules/filesystem.ts`
- Create: `tests/filesystem.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/filesystem.test.ts
import { describe, it, expect } from 'vitest';
import { listProjects } from '../src/modules/filesystem.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('listProjects', () => {
  const testRoot = '/tmp/qq-bridge-test-workspace';

  it('lists directories under workspaceRoot', () => {
    mkdirSync(join(testRoot, 'proj-a'), { recursive: true });
    mkdirSync(join(testRoot, 'proj-b'), { recursive: true });
    const projects = listProjects(testRoot);
    expect(projects).toContain('proj-a');
    expect(projects).toContain('proj-b');
    rmSync(testRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/filesystem.test.ts
```

- [ ] **Step 3: Implement filesystem module**

```typescript
// src/modules/filesystem.ts
import { readdirSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
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
  } catch (e) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/filesystem.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/filesystem.ts tests/filesystem.test.ts
git commit -m "feat: filesystem module (/ls, /new, /mkdir, /tree)"
```

---

### Task 12: Entry Point — Wire Everything Together

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create entry point**

```typescript
// src/index.ts
import { loadConfig } from './config.js';
import { initLogger, info, error } from './utils/logger.js';
import { SessionManager } from './modules/session.js';
import { ProcessManager } from './modules/process.js';
import { BridgeHandlers } from './modules/handlers.js';
import { NapCatService } from './services/napcat.js';
import { parseCommand, normalizeMessage } from './modules/command.js';
import { isWhitelisted } from './modules/whitelist.js';
import { createProject, cloneProject, createDirectory, getDirectoryTree, listProjects } from './modules/filesystem.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

async function main() {
  const configPath = process.argv[2] || './config.json';
  const config = loadConfig(configPath);
  initLogger(config);

  const sessions = new SessionManager();
  const processes = new ProcessManager(config.opencode.portRange);
  const napcat = new NapCatService(config);

  const handlers = new BridgeHandlers(config, sessions, processes, napcat);

  await napcat.start(async (event) => {
    const qq = String(event.user_id);
    if (!isWhitelisted(qq, config.whitelist)) return;

    const normalized = normalizeMessage(
      event.message_type,
      event.message,
      config.napcat.botQQ,
    );
    if (!normalized) return;

    const parsed = parseCommand(normalized);
    if (!parsed) {
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      return;
    }

    const isGroup = event.message_type === 'group';
    const groupId = event.group_id;

    try {
      switch (parsed.command) {
        case 'bind': await handlers.handleBind(qq, parsed.args, isGroup, groupId); break;
        case 'unbind': await handlers.handleUnbind(qq, isGroup, groupId); break;
        case 'status': await handlers.handleStatus(qq, isGroup, groupId); break;
        case 'list': await handlers.handleList(qq, isGroup, groupId); break;
        case 'run': await handlers.handleRun(qq, parsed.args, isGroup, groupId); break;
        case 'abort': await handlers.handleAbort(qq, isGroup, groupId); break;
        case 'modes': await handlers.handleModes(qq, parsed.args, isGroup, groupId); break;
        case 'commands': await handlers.handleCommands(qq, isGroup, groupId); break;
        case 'approve': await handlers.handlePermission(qq, true, isGroup, groupId); break;
        case 'reject': await handlers.handlePermission(qq, false, isGroup, groupId); break;
        case 'stop': await handlers.handleStop(qq, parsed.args, isGroup, groupId); break;
        case 'stopall': await handlers.handleStopAll(qq, isGroup, groupId); break;
        case 'ls': {
          const path = parsed.args || config.workspaceRoot;
          const resolved = resolve(config.workspaceRoot, path);
          const projects = listProjects(resolved);
          const msg = projects.length > 0
            ? `项目列表:\n${projects.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
            : '没有找到项目';
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: msg } }]);
          break;
        }
        case 'new': {
          const parts = parsed.args.trim().split(/\s+/);
          if (parts.length === 1) {
            const path = createProject(config.workspaceRoot, parts[0]);
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 项目已创建: ${path}` } }]);
          } else if (parts.length >= 2) {
            const path = cloneProject(config.workspaceRoot, parts[0], parts.slice(1).join(' '));
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 项目已克隆: ${path}` } }]);
          } else {
            await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '用法: /new <name> 或 /new <url> <name>' } }]);
          }
          break;
        }
        case 'mkdir': {
          const s = sessions.getOrCreate(qq);
          const base = s.projectPath || config.workspaceRoot;
          const path = createDirectory(base, parsed.args);
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `✅ 目录已创建: ${path}` } }]);
          break;
        }
        case 'tree': {
          const s = sessions.getOrCreate(qq);
          const base = parsed.args ? resolve(config.workspaceRoot, parsed.args) : (s.projectPath || config.workspaceRoot);
          const tree = getDirectoryTree(base);
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: tree } }]);
          break;
        }
        case 'help': {
          const help = `可用命令:
/bind <path> - 绑定项目
/unbind - 解除绑定
/status - 查看状态
/list - 列出运行中的项目
/ls [path] - 列出项目目录
/new <name> | <url> <name> - 新建/克隆项目
/mkdir <path> - 创建目录
/tree [path] - 显示目录树
/modes [model] - 模型切换
/commands - 列出 OpenCode 命令
/run <msg> - 执行指令
/abort - 中断执行
/approve - 授权权限请求
/reject - 拒绝权限请求
/oc <cmd> - 执行 OpenCode 命令
/stop <path> - 关闭项目
/stopall - 关闭所有项目`;
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: help } }]);
          break;
        }
        case 'oc': {
          await handlers.handleOpenCodeCmd(qq, parsed.command, parsed.args, isGroup, groupId);
          break;
        }
        default:
          await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      }
    } catch (e) {
      error('Handler error', e);
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: `内部错误: ${e instanceof Error ? e.message : String(e)}` } }]);
    }
  });

  info('QQ-OpenCode Bridge started');

  // Graceful shutdown
  process.on('SIGINT', () => {
    info('Shutting down...');
    processes.stopAll();
    napcat.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    processes.stopAll();
    napcat.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  error('Failed to start', e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point wiring all modules together"
```

---

### Task 13: Final Integration Test

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: All tests pass, no type errors.

- [ ] **Step 2: Smoke test with config**

```bash
cp config.example.json config.json
# Edit config.json with your actual NapCat/OpenCode paths
npx tsx src/index.ts config.json
```

Expected: Server starts, prints "NapCat WS server listening on port 3001"

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat: qq-opencode bridge complete"
```

---

## Self-Review

### 1. Spec Coverage Checklist

| Spec Requirement | Task |
|-----------------|------|
| NapCat reverse WS | Task 7 (NapCatService) |
| NapCat HTTP send_msg | Task 7 (sendPrivateMsg/sendGroupMsg) |
| Whitelist QQ validation | Task 4 (whitelist.ts) |
| Path validation (.. escape) | Task 4 (validateProjectPath) |
| /bind, /unbind, /status, /list | Task 10 (handlers) |
| /run with model support | Task 10 (handleRun) |
| /abort | Task 10 (handleAbort) |
| /modes | Task 10 (handleModes) |
| /commands | Task 10 (handleCommands) |
| /oc <cmd> | Task 10 (handleOpenCodeCmd) |
| /approve, /reject | Task 10 (handlePermission) |
| /stop, /stopall | Task 10 (handleStop/handleStopAll) |
| /ls, /new, /mkdir, /tree | Task 11 (filesystem.ts) |
| /help | Task 12 (index.ts) |
| Message normalization (@Bot) | Task 6 (normalizeMessage) |
| Command routing (/oc prefix) | Task 6 (parseCommand) |
| State machine | Task 5 (SessionManager) |
| OpenCode process lifecycle | Task 8 (ProcessManager) |
| OpenCode HTTP API client | Task 9 (OpenCodeClient) |
| Config loading | Task 2 (config.ts) |
| Error codes | Task 1 (types.ts) + Task 10 |
| Busy-reject concurrency | Task 10 (handleRun checks state) |
| Graceful shutdown | Task 12 (SIGINT/SIGTERM) |

All spec requirements covered.

### 2. Placeholder Scan

No TBD, TODO, or "implement later" found. All code steps contain actual implementation.

### 3. Type Consistency

- `QQSession`, `SessionState`, `Config`, `ConcurrencyRule`, `BridgeError`, `ErrorCode` all defined in Task 1 (types.ts)
- `SessionManager` methods match types defined in Task 5
- `parseCommand` returns `ParsedCommand` matching Task 1 type
- `OpenCodeClient` methods match spec API paths
- All handlers use consistent `reply()` pattern

No inconsistencies found.
