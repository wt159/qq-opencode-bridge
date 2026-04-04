# Interactive Dialogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable full interactive dialogue between QQ users and OpenCode — permission requests with pattern-based auto-approve, manual approve/reject via commands, and free text forwarding during active sessions.

**Architecture:** Extract event handling from `handleRun` into a dedicated `EventProcessor` state machine. Add a `PermissionRules` pattern-matching engine for auto-approve decisions. The event loop delegates to `EventProcessor.handleEvent()` which decides whether to auto-approve or notify the QQ user. Free text is forwarded as follow-up messages only when the session is actively running.

**Tech Stack:** TypeScript (ESM), Node.js, Vitest, minimatch (new dependency for glob patterns)

**Spec:** `docs/superpowers/specs/2026-04-04-interactive-dialogue-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `PermissionData`, `PermissionRule`, extend `Config`, extend `OpenCodeEvent` |
| `src/config.ts` | Modify | Apply defaults for new `permissions` config field |
| `src/modules/permission-rules.ts` | **Create** | Pattern-matching auto-approve engine |
| `tests/permission-rules.test.ts` | **Create** | PermissionRules unit tests |
| `src/modules/event-processor.ts` | **Create** | Event handling state machine |
| `tests/event-processor.test.ts` | **Create** | EventProcessor unit tests |
| `src/modules/session.ts` | Modify | Add `setPendingPermission` / `clearPendingPermission` methods |
| `tests/session.test.ts` | Modify | Add permission state management tests |
| `src/modules/handlers.ts` | Modify | Refactor `handleRun` to use EventProcessor; complete `handlePermission` |
| `src/index.ts` | Modify | Add free text forwarding when session is running |
| `tests/command.test.ts` | Modify | Add `/approve` and `/reject` parsing tests |
| `tests/handlers.test.ts` | Modify | Add permission interaction tests |

---

### Task 1: Extend types and config defaults

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add new types to `src/types.ts`**

Add after the `ConcurrencyRule` interface (line 31), before the `// ── Runtime State` comment:

```typescript
// ── Permission Rules ──────────────────────────────────────────

export interface PermissionData {
  id: string;
  messageID: string;
  sessionID: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
  callID?: string;
  pattern?: string | string[];
}

export interface PermissionRule {
  pattern: string;
  response: 'once' | 'always' | 'reject';
}
```

Add `permissions` field to the `Config` interface (after the `log` field, before the closing brace at line 25):

```typescript
  permissions?: {
    autoApprovePatterns: PermissionRule[];
    defaultAction: 'ask' | 'allow' | 'reject';
  };
```

- [ ] **Step 2: Add config defaults in `src/config.ts`**

In `loadConfig`, after parsing JSON and before `validateConfig`, apply defaults:

```typescript
export function loadConfig(configPath: string): Config {
  const absolute = resolve(configPath);
  const raw = readFileSync(absolute, 'utf-8');
  const config = JSON.parse(raw) as Config;
  config.permissions = {
    autoApprovePatterns: config.permissions?.autoApprovePatterns ?? [],
    defaultAction: config.permissions?.defaultAction ?? 'ask',
  };
  validateConfig(config);
  return config;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no new type errors — all additions are backward-compatible)

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `npm test`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "feat: add PermissionData, PermissionRule types and config defaults"
```

---

### Task 2: Create PermissionRules module with tests

**Files:**
- Create: `src/modules/permission-rules.ts`
- Create: `tests/permission-rules.test.ts`

- [ ] **Step 1: Write failing tests for PermissionRules**

Create `tests/permission-rules.test.ts`:

```typescript
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
    // type:title would match "bash:Run command: ls", but pattern is "bash:git status"
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/permission-rules.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/modules/permission-rules.ts`**

```typescript
import { minimatch } from 'minimatch';
import type { PermissionData, PermissionRule } from '../types.js';

export class PermissionRules {
  constructor(
    private rules: PermissionRule[],
    private defaultAction: 'ask' | 'allow' | 'reject',
  ) {}

  evaluate(permission: PermissionData): 'once' | 'always' | 'reject' | null {
    for (const rule of this.rules) {
      if (this.matchRule(permission, rule)) {
        return rule.response;
      }
    }
    if (this.defaultAction === 'allow') return 'once';
    if (this.defaultAction === 'reject') return 'reject';
    return null;
  }

  private matchRule(permission: PermissionData, rule: PermissionRule): boolean {
    // Prefer permission.pattern if present
    if (permission.pattern) {
      const patterns = Array.isArray(permission.pattern)
        ? permission.pattern
        : [permission.pattern];
      return patterns.some((p) => minimatch(p, rule.pattern));
    }
    // Fallback: match against composite key type:title
    return minimatch(`${permission.type}:${permission.title}`, rule.pattern);
  }
}
```

- [ ] **Step 4: Install minimatch dependency**

Run: `npm install minimatch && npm install -D @types/minimatch`
Expected: dependency added to package.json

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/permission-rules.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests PASS (existing + new)

- [ ] **Step 7: Commit**

```bash
git add src/modules/permission-rules.ts tests/permission-rules.test.ts package.json package-lock.json
git commit -m "feat: add PermissionRules pattern-matching engine with tests"
```

---

### Task 3: Extend OpenCodeEvent type for permission events

**Files:**
- Modify: `src/services/opencode.ts`

- [ ] **Step 1: Add permission field to OpenCodeEvent properties**

In `src/services/opencode.ts`, replace the `OpenCodeEvent` type (lines 1-9) with:

```typescript
import type { PermissionData } from '../types.js';

export type OpenCodeEvent = {
  type: string;
  properties?: {
    sessionID?: string;
    status?: { type: string };
    part?: { type: string; text?: string };
    error?: { name?: string; data?: { message?: string } };
    permission?: PermissionData;
  };
};
```

Note: The import must use `'../types.js'` per the project's ESM `.js` suffix convention.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/opencode.ts
git commit -m "feat: extend OpenCodeEvent type with permission field"
```

---

### Task 4: Create EventProcessor module with tests

**Files:**
- Create: `src/modules/event-processor.ts`
- Create: `tests/event-processor.test.ts`

- [ ] **Step 1: Write failing tests for EventProcessor**

Create `tests/event-processor.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventProcessor } from '../src/modules/event-processor.js';
import { PermissionRules } from '../src/modules/permission-rules.js';
import { OpenCodeClient } from '../src/services/opencode.js';
import type { OpenCodeEvent } from '../src/services/opencode.js';
import type { PermissionData } from '../src/types.js';

// Mock OpenCodeClient
vi.mock('../src/services/opencode.js', () => {
  return {
    OpenCodeClient: vi.fn().mockImplementation(() => ({
      respondToPermission: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

function makeEvent(type: string, properties: Record<string, unknown> = {}): OpenCodeEvent {
  return { type, properties };
}

function makePermEvent(perm: Partial<PermissionData> = {}): OpenCodeEvent {
  const permission: PermissionData = {
    id: 'perm-1',
    messageID: 'msg-1',
    sessionID: 'ses-1',
    title: 'Run command: rm -rf /',
    type: 'bash',
    metadata: {},
    ...perm,
  };
  return { type: 'permission.updated', properties: { permission, sessionID: 'ses-1' } };
}

describe('EventProcessor', () => {
  function createProcessor(rules?: PermissionRules) {
    const permissionRules = rules ?? new PermissionRules([], 'ask');
    const client = new OpenCodeClient(3000);
    const callbacks = {
      onText: vi.fn(),
      onPermissionRequest: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const processor = new EventProcessor(permissionRules, client, 'ses-1', callbacks);
    return { processor, client, callbacks };
  }

  it('accumulates text from message.part.updated events', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'Hello ' },
    }));
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'World' },
    }));
    expect(callbacks.onText).toHaveBeenCalledWith('Hello ');
    expect(callbacks.onText).toHaveBeenCalledWith('World');
    expect(processor.currentText).toBe('Hello World');
  });

  it('ignores non-text part types in message.part.updated', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'tool-use', text: 'ignored' },
    }));
    expect(callbacks.onText).not.toHaveBeenCalled();
    expect(processor.currentText).toBe('');
  });

  it('fires onComplete on session.idle event', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'result' },
    }));
    await processor.handleEvent(makeEvent('session.idle', { sessionID: 'ses-1' }));
    expect(callbacks.onComplete).toHaveBeenCalledWith('result');
    expect(processor.currentState).toBe('done');
  });

  it('fires onComplete on session.status idle event (backward compat)', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'ok' },
    }));
    await processor.handleEvent(makeEvent('session.status', {
      sessionID: 'ses-1',
      status: { type: 'idle' },
    }));
    expect(callbacks.onComplete).toHaveBeenCalledWith('ok');
    expect(processor.currentState).toBe('done');
  });

  it('fires onError on session.error event', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('session.error', {
      sessionID: 'ses-1',
      error: { data: { message: 'something broke' } },
    }));
    expect(callbacks.onError).toHaveBeenCalledWith('something broke');
    expect(processor.currentState).toBe('done');
  });

  it('fires onError with default message when no error message present', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('session.error', {
      sessionID: 'ses-1',
    }));
    expect(callbacks.onError).toHaveBeenCalledWith('OpenCode 执行失败');
  });

  it('auto-approves permission when rules match', async () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:Run command: git *', response: 'once' }],
      'ask',
    );
    const { processor, client, callbacks } = createProcessor(rules);
    const event = makePermEvent({ title: 'Run command: git status' });
    await processor.handleEvent(event);
    expect(client.respondToPermission).toHaveBeenCalledWith('ses-1', 'perm-1', 'once');
    expect(callbacks.onPermissionRequest).not.toHaveBeenCalled();
    expect(processor.currentState).toBe('streaming');
  });

  it('notifies user when no rule matches permission', async () => {
    const { processor, callbacks } = createProcessor();
    const event = makePermEvent();
    await processor.handleEvent(event);
    expect(callbacks.onPermissionRequest).toHaveBeenCalled();
    const perm = callbacks.onPermissionRequest.mock.calls[0][0] as PermissionData;
    expect(perm.id).toBe('perm-1');
    expect(perm.title).toBe('Run command: rm -rf /');
    expect(processor.currentState).toBe('waiting_permission');
  });

  it('handles auto-approve API failure gracefully', async () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:*', response: 'once' }],
      'ask',
    );
    const { processor, client, callbacks } = createProcessor(rules);
    (client.respondToPermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('API error'),
    );
    const event = makePermEvent();
    await processor.handleEvent(event);
    // Should degrade to notifying user
    expect(callbacks.onPermissionRequest).toHaveBeenCalled();
    expect(processor.currentState).toBe('waiting_permission');
  });

  it('respondToPermission calls API and resumes streaming', async () => {
    const { processor, client, callbacks } = createProcessor();
    const event = makePermEvent();
    await processor.handleEvent(event);
    expect(processor.currentState).toBe('waiting_permission');

    await processor.respondToPermission('perm-1', 'once');
    expect(client.respondToPermission).toHaveBeenCalledWith('ses-1', 'perm-1', 'once');
    expect(processor.currentState).toBe('streaming');
  });

  it('ignores unknown event types', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('unknown.event', { foo: 'bar' }));
    expect(callbacks.onText).not.toHaveBeenCalled();
    expect(callbacks.onPermissionRequest).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(processor.currentState).toBe('streaming');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/event-processor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/modules/event-processor.ts`**

```typescript
import type { PermissionData } from '../types.js';
import type { OpenCodeClient } from '../services/opencode.js';
import type { OpenCodeEvent } from '../services/opencode.js';
import type { PermissionRules } from './permission-rules.js';
import { info } from '../utils/logger.js';

export type EventProcessorState = 'streaming' | 'waiting_permission' | 'done';

export type EventProcessorCallbacks = {
  onText: (text: string) => void;
  onPermissionRequest: (perm: PermissionData) => void;
  onComplete: (text: string) => void;
  onError: (error: string) => void;
};

export class EventProcessor {
  private text = '';
  private state: EventProcessorState = 'streaming';

  constructor(
    private rules: PermissionRules,
    private client: OpenCodeClient,
    private sessionId: string,
    private callbacks: EventProcessorCallbacks,
  ) {}

  async handleEvent(event: OpenCodeEvent): Promise<void> {
    switch (event.type) {
      case 'message.part.updated': {
        const props = event.properties as {
          part?: { type?: string; text?: string };
        } | undefined;
        const part = props?.part;
        if (part?.type === 'text' && part.text) {
          this.text += part.text;
          this.callbacks.onText(part.text);
        }
        break;
      }

      case 'permission.updated': {
        const props = event.properties as {
          permission?: PermissionData;
        } | undefined;
        const perm = props?.permission;
        if (!perm) break;

        const decision = this.rules.evaluate(perm);
        if (decision) {
          try {
            await this.client.respondToPermission(this.sessionId, perm.id, decision);
          } catch (e) {
            info('Auto-approve failed, degrading to manual confirmation', e);
            this.state = 'waiting_permission';
            this.callbacks.onPermissionRequest(perm);
          }
        } else {
          this.state = 'waiting_permission';
          this.callbacks.onPermissionRequest(perm);
        }
        break;
      }

      case 'session.idle':
      case 'session.status': {
        // Handle both session.idle (newer OpenCode) and session.status with idle subtype (older)
        if (event.type === 'session.status') {
          const props = event.properties as {
            status?: { type?: string };
          } | undefined;
          if (props?.status?.type !== 'idle') break;
        }
        this.state = 'done';
        this.callbacks.onComplete(this.text);
        break;
      }

      case 'session.error': {
        const props = event.properties as {
          error?: { data?: { message?: string } };
        } | undefined;
        const msg = props?.error?.data?.message || 'OpenCode 执行失败';
        this.state = 'done';
        this.callbacks.onError(msg);
        break;
      }

      default:
        // Ignore unknown event types
        break;
    }
  }

  async respondToPermission(permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    await this.client.respondToPermission(this.sessionId, permissionId, response);
    this.state = 'streaming';
  }

  get currentState(): EventProcessorState {
    return this.state;
  }

  get currentText(): string {
    return this.text;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/event-processor.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/event-processor.ts tests/event-processor.test.ts
git commit -m "feat: add EventProcessor state machine with permission handling"
```

---

### Task 5: Add session permission state management

**Files:**
- Modify: `src/modules/session.ts`
- Modify: `tests/session.test.ts`

- [ ] **Step 1: Write failing tests for permission state management**

Add to `tests/session.test.ts` (after the last `it` block):

```typescript
  it('sets pending permission', () => {
    mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
    mgr.setPendingPermission('123', 'perm-1');
    const s = mgr.getOrCreate('123');
    expect(s.state).toBe('permission_pending');
    expect(s.pendingPermissionId).toBe('perm-1');
  });

  it('clears pending permission and resumes running', () => {
    mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
    mgr.setPendingPermission('123', 'perm-1');
    mgr.clearPendingPermission('123', 'running');
    const s = mgr.getOrCreate('123');
    expect(s.state).toBe('running');
    expect(s.pendingPermissionId).toBeNull();
  });

  it('clears pending permission and resumes idle', () => {
    mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
    mgr.setPendingPermission('123', 'perm-1');
    mgr.clearPendingPermission('123', 'idle');
    const s = mgr.getOrCreate('123');
    expect(s.state).toBe('idle');
    expect(s.pendingPermissionId).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — `setPendingPermission` is not a function

- [ ] **Step 3: Add methods to SessionManager**

In `src/modules/session.ts`, add after `setModel` method (after line 49):

```typescript
  setPendingPermission(qq: string, permissionId: string): void {
    const s = this.getOrCreate(qq);
    s.state = 'permission_pending';
    s.pendingPermissionId = permissionId;
  }

  clearPendingPermission(qq: string, nextState: SessionState): void {
    const s = this.getOrCreate(qq);
    s.pendingPermissionId = null;
    s.state = nextState;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/session.test.ts`
Expected: All tests PASS (existing 5 + new 3 = 8)

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/session.ts tests/session.test.ts
git commit -m "feat: add permission state management to SessionManager"
```

---

### Task 6: Refactor handleRun to use EventProcessor and complete handlePermission

**Files:**
- Modify: `src/modules/handlers.ts`

- [ ] **Step 1: Add imports to handlers.ts**

Replace the imports at the top of `src/modules/handlers.ts` (lines 1-10) with:

```typescript
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Config, PermissionData } from '../types.js';
import { BridgeError } from '../types.js';
import { SessionManager } from './session.js';
import { ProcessManager } from './process.js';
import { OpenCodeClient } from '../services/opencode.js';
import { NapCatService } from '../services/napcat.js';
import { validateProjectPath } from './whitelist.js';
import { info } from '../utils/logger.js';
import { PermissionRules } from './permission-rules.js';
import { EventProcessor } from './event-processor.js';
```

- [ ] **Step 2: Add activeProcessors map and permissionRules to BridgeHandlers**

Add after the constructor (after line 28):

```typescript
  private activeProcessors = new Map<string, EventProcessor>();

  private get permissionRules(): PermissionRules {
    const perms = this.config.permissions;
    return new PermissionRules(
      perms?.autoApprovePatterns ?? [],
      perms?.defaultAction ?? 'ask',
    );
  }
```

- [ ] **Step 3: Replace handleRun method**

Replace the entire `handleRun` method (lines 256-345) with:

```typescript
  async handleRun(qq: string, args: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (!s.sessionId) return this.reply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);
    if (s.state === 'permission_pending') return this.reply(qq, '请先 /approve 或 /reject 当前权限请求', isGroup, groupId);
    if (s.state !== 'idle') return this.reply(qq, '当前有命令正在执行，请稍后或使用 /abort 中断', isGroup, groupId);

    s.state = 'running';
    await this.reply(qq, '正在执行...', isGroup, groupId);

    try {
      const client = this.getClient(qq);
      const model = await this.resolveRunModel(qq);
      const events = client.subscribeEvents(s.sessionId!);
      const eventIterator = events[Symbol.asyncIterator]();

      let responseReady = false;
      const timeoutMs = Math.max(this.config.opencode.commandTimeout, 30 * 60 * 1000);
      const timeout = setTimeout(() => {
        if (!responseReady) {
          events.controller.abort();
          s.state = 'idle';
          this.activeProcessors.delete(qq);
          this.reply(qq, '命令执行超时，请稍后重试', isGroup, groupId);
        }
      }, timeoutMs);

      const sendWithModel = async (currentModel: { providerID: string; modelID: string } | undefined) => {
        await client.sendMessage(s.sessionId!, args, currentModel, events.controller.signal);
      };

      try {
        await sendWithModel(model);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('Model not found')) {
          const fallbackModel = await this.resolveDefaultRunModel(s.projectPort);
          if (fallbackModel && (!model || model.providerID !== fallbackModel.providerID || model.modelID !== fallbackModel.modelID)) {
            s.model = `${fallbackModel.providerID}/${fallbackModel.modelID}`;
            await sendWithModel(fallbackModel);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }

      const processor = new EventProcessor(
        this.permissionRules,
        client,
        s.sessionId!,
        {
          onText: () => {},
          onPermissionRequest: (perm: PermissionData) => {
            this.sessions.setPendingPermission(qq, perm.id);
            this.reply(qq, `⚠️ 权限请求: ${perm.title}\n使用 /approve 或 /reject 回复`, isGroup, groupId);
          },
          onComplete: (text: string) => {
            responseReady = true;
            clearTimeout(timeout);
            this.sessions.clearPendingPermission(qq, 'idle');
            this.activeProcessors.delete(qq);
            this.reply(qq, text || '(无输出)', isGroup, groupId);
          },
          onError: (errorMsg: string) => {
            responseReady = true;
            clearTimeout(timeout);
            this.sessions.clearPendingPermission(qq, 'idle');
            this.activeProcessors.delete(qq);
            this.reply(qq, `执行失败: ${errorMsg}`, isGroup, groupId);
          },
        },
      );
      this.activeProcessors.set(qq, processor);

      try {
        let next = await eventIterator.next();
        while (!next.done) {
          const event = next.value;
          await processor.handleEvent(event);
          if (processor.currentState === 'done') {
            responseReady = true;
            clearTimeout(timeout);
            break;
          }
          next = await eventIterator.next();
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!responseReady) {
          this.reply(qq, `执行失败: ${message}`, isGroup, groupId);
        }
      } finally {
        events.controller.abort();
        this.activeProcessors.delete(qq);
      }

      s.state = 'idle';
    } catch (e) {
      s.state = 'idle';
      this.activeProcessors.delete(qq);
      return this.reply(qq, `执行失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }
```

- [ ] **Step 4: Replace handlePermission method**

Replace the entire `handlePermission` method (lines 458-464) with:

```typescript
  async handlePermission(qq: string, approve: boolean, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'permission_pending' || !s.pendingPermissionId) {
      return this.reply(qq, '当前没有待确认的权限请求', isGroup, groupId);
    }

    const processor = this.activeProcessors.get(qq);
    if (!processor) {
      return this.reply(qq, '没有活跃的执行会话', isGroup, groupId);
    }

    const response = approve ? 'once' : 'reject';
    try {
      await processor.respondToPermission(s.pendingPermissionId, response);
      this.sessions.clearPendingPermission(qq, 'running');
      return this.reply(qq, approve ? '✅ 已授权' : '❌ 已拒绝', isGroup, groupId);
    } catch (e) {
      return this.reply(qq, `授权失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }
```

- [ ] **Step 5: Also update handleAbort to accept permission_pending state**

Replace the `handleAbort` method (lines 347-361) with:

```typescript
  async handleAbort(qq: string, isGroup: boolean, groupId?: number): Promise<void> {
    const s = this.sessions.getOrCreate(qq);
    if (s.state !== 'running' && s.state !== 'permission_pending') {
      return this.reply(qq, '当前没有正在执行的命令', isGroup, groupId);
    }

    s.state = 'aborting';
    try {
      const client = this.getClient(qq);
      await client.abort(s.sessionId!);
      s.state = 'idle';
      s.pendingPermissionId = null;
      this.activeProcessors.delete(qq);
      return this.reply(qq, '已中断', isGroup, groupId);
    } catch (e) {
      s.state = 'idle';
      s.pendingPermissionId = null;
      this.activeProcessors.delete(qq);
      return this.reply(qq, `中断失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
    }
  }
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/handlers.ts
git commit -m "feat: refactor handleRun with EventProcessor, complete handlePermission"
```

---

### Task 7: Add free text forwarding in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add OpenCodeClient import**

Add to the imports at the top of `src/index.ts` (after line 9):

```typescript
import { OpenCodeClient } from './services/opencode.js';
```

- [ ] **Step 2: Replace the non-command text handling block**

Replace lines 34-38 in `src/index.ts`:

```typescript
    const parsed = parseCommand(normalized);
    if (!parsed) {
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      return;
    }
```

With:

```typescript
    const parsed = parseCommand(normalized);
    if (!parsed) {
      // Free text forwarding: only when session is actively running
      const session = sessions.getOrCreate(qq);
      if (session.state === 'running' && session.sessionId && session.projectPort) {
        try {
          const client = new OpenCodeClient(session.projectPort, config.opencode.password);
          await client.sendMessage(session.sessionId, normalized);
        } catch (e) {
          error('Free text forward failed', e);
        }
        return;
      }
      await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
      return;
    }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: forward free text to OpenCode during active sessions"
```

---

### Task 8: Add permission interaction handler tests

**Files:**
- Modify: `tests/handlers.test.ts`
- Modify: `tests/command.test.ts`

- [ ] **Step 1: Add /approve and /reject parsing tests to `tests/command.test.ts`**

Add after the last `it` block in `parseCommand` describe:

```typescript
  it('parses approve command', () => {
    const cmd = parseCommand('/approve');
    expect(cmd).toEqual({ type: 'bridge', command: 'approve', args: '' });
  });

  it('parses reject command', () => {
    const cmd = parseCommand('/reject');
    expect(cmd).toEqual({ type: 'bridge', command: 'reject', args: '' });
  });
```

- [ ] **Step 2: Add permission handling tests to `tests/handlers.test.ts`**

Add a new describe block at the end of the file (before the final closing):

```typescript
describe('BridgeHandlers permission', () => {
  const config: Config = {
    whitelist: ['123'],
    workspaceRoot: '/home/wtp/workspace/opencode-napcatqq',
    napcat: {
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      botQQ: '3260465307',
    },
    opencode: {
      binaryPath: 'opencode',
      portRange: [3002, 3010],
      commandTimeout: 60000,
    },
    concurrency: {
      allowMultiQQPerProject: false,
      rejectWhenBusy: false,
      abortOwnOnly: true,
    },
    log: {
      level: 'INFO',
    },
  };

  let sessions: SessionManager;
  let processes: ProcessManager;
  let napcat: MockNapCatService;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    sessions = new SessionManager();
    processes = new ProcessManager([3002, 3010]);
    napcat = new MockNapCatService(config);
    handlers = new BridgeHandlers(config, sessions, processes, napcat);
  });

  it('rejects approve when no permission pending', async () => {
    await handlers.handlePermission('123', true, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '当前没有待确认的权限请求' } },
    ]);
  });

  it('rejects reject when no permission pending', async () => {
    await handlers.handlePermission('123', false, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '当前没有待确认的权限请求' } },
    ]);
  });

  it('rejects approve when no active processor', async () => {
    sessions.bindProject('123', '/workspace/proj', 3002, 'ses-1');
    sessions.setPendingPermission('123', 'perm-1');
    await handlers.handlePermission('123', true, false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '没有活跃的执行会话' } },
    ]);
  });

  it('rejects run when permission_pending', async () => {
    sessions.bindProject('123', '/workspace/proj', 3002, 'ses-1');
    sessions.setPendingPermission('123', 'perm-1');
    await handlers.handleRun('123', 'do something', false);
    expect(napcat.messages.at(-1)?.message).toEqual([
      { type: 'text', data: { text: '请先 /approve 或 /reject 当前权限请求' } },
    ]);
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/handlers.test.ts tests/command.test.ts
git commit -m "test: add permission interaction and command parsing tests"
```

---

### Task 9: Final verification and cleanup

**Files:**
- All files

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, zero errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Verify no pre-existing tests were broken**

Run: `npx vitest run --reporter=verbose`
Expected: Review output — all test suites pass, no skips or failures

- [ ] **Step 4: Final commit (if any fixups needed)**

Only if verification revealed issues that needed fixing.
