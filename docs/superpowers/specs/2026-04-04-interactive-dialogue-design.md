# Interactive Dialogue Design

**Date**: 2026-04-04
**Status**: Draft
**Scope**: Full interactive dialogue between QQ users and OpenCode (permissions + free text)

## 1. Background

The bridge currently handles OpenCode events one-way: user sends `/run`, bridge collects SSE text, replies when done. OpenCode's `permission.updated` event — where the LLM pauses and asks for user confirmation before executing a tool (shell command, file write, etc.) — is completely ignored despite having skeleton code for it.

### OpenCode SSE Event Protocol (from `sst/opencode-sdk-go`)

| Event Type | Purpose | Bridge Status |
|---|---|---|
| `message.part.updated` | Streaming text output | Handled |
| `session.idle` | Execution complete | Handled (as `session.status`) |
| `session.error` | Execution error | Handled |
| **`permission.updated`** | **Tool permission request** | **NOT handled** |
| `permission.replied` | Permission response confirmation | NOT handled |
| `message.updated` | Full message update | NOT handled |
| `message.removed` | Message deletion | NOT handled |
| `message.part.removed` | Message part deletion | NOT handled |
| `session.compacted` | Session compaction | NOT handled |
| `session.created/updated/deleted` | Session lifecycle | NOT handled |
| `todo.updated` | Todo list update | NOT handled |
| `file.edited` | File edit notification | NOT handled |
| `file.watcher.updated` | File watcher event | NOT handled |
| `installation.updated` | Installation update | NOT handled |
| `lsp.client.diagnostics` | LSP diagnostics | NOT handled |

### Permission Data Structure

```typescript
// From OpenCode SDK: permission.updated event properties
interface PermissionData {
  id: string;                          // Permission request ID
  messageID: string;                   // Associated message ID
  sessionID: string;                   // Session ID
  title: string;                       // Human-readable title (e.g. "Run command: rm -rf ...")
  type: string;                        // Permission type
  metadata: Record<string, unknown>;   // Additional metadata
  callID?: string;                     // Tool call ID
  pattern?: string | string[];         // Match patterns
}

// Response API: POST /session/{sessionId}/permissions/{permissionId}
// Body: { response: "once" | "always" | "reject" }
```

### Current Skeleton Code (incomplete)

- `SessionState.permission_pending` — defined but never assigned
- `QQSession.pendingPermissionId` — defined but never assigned
- `OpenCodeClient.respondToPermission()` — defined but never called
- `handlePermission()` — only replies text, does not call API

## 2. Requirements

### 2.1 User Choices

- **Scope**: Full interactive dialogue (permissions + free text input)
- **Auto-approve strategy**: Pattern matching with configurable rules
- **Free text**: Forward to OpenCode only when session is in a waiting state

### 2.2 Functional Requirements

1. **Permission handling**: Detect `permission.updated` events, auto-approve matching patterns, forward unmatched requests to QQ user
2. **User response**: `/approve` and `/reject` commands call the real OpenCode permission API
3. **Free text forwarding**: When session is `permission_pending` or `running`, non-command text is forwarded as a follow-up message to OpenCode
4. **Pattern auto-approve**: Configurable glob patterns match against permission `type`, `title`, and `pattern` fields
5. **Backward compatibility**: Existing commands and behavior unchanged

### 2.3 Non-functional Requirements

- All new modules must be independently testable
- No breaking changes to existing command protocol
- Config additions must be backward-compatible (new fields optional with defaults)

## 3. Architecture

```
QQ Message --> index.ts (router)
                |
                +-- command --> handlers.ts (existing logic)
                |       +-- /approve, /reject --> PermissionRules --> respondToPermission()
                |       +-- /run --> EventProcessor (new module)
                |
                +-- free text (waiting state only) --> EventProcessor --> sendMessage()

OpenCode SSE --> EventProcessor (state machine)
                    |
                    +-- message.part.updated --> accumulate text
                    +-- permission.updated --> pattern match
                    |       +-- match found --> respondToPermission("once"/"always"/"reject")
                    |       +-- no match --> set state + notify QQ user
                    +-- session.idle --> complete
                    +-- session.error --> fail
```

## 4. File Changes

| File | Change Type | Responsibility |
|---|---|---|
| `src/modules/event-processor.ts` | **New** | Event handling state machine |
| `src/modules/permission-rules.ts` | **New** | Pattern matching rule engine |
| `src/types.ts` | Modify | Extended event types, new state, config additions |
| `src/modules/handlers.ts` | Modify | `handleRun` uses EventProcessor; `handlePermission` calls real API |
| `src/modules/session.ts` | Modify | Permission state management methods |
| `src/index.ts` | Modify | Free text forwarding + new command routing |
| `tests/permission-rules.test.ts` | **New** | Pattern matching tests |
| `tests/event-processor.test.ts` | **New** | State machine tests |

## 5. Type Extensions

### 5.1 `src/types.ts`

```typescript
// Add to SessionState union
export type SessionState =
  | 'idle'
  | 'running'
  | 'permission_pending'
  | 'aborting'
  | 'restarting'
  | 'stopped';

// Extend OpenCodeEvent
export type OpenCodeEvent = {
  type: string;
  properties?: {
    sessionID?: string;
    part?: { type: string; text?: string };
    error?: { name?: string; data?: { message?: string } };
    status?: { type: string };
    permission?: PermissionData;
  };
};

// New types
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

// Add to Config (optional with defaults)
export interface Config {
  // ...existing fields...
  permissions?: {
    autoApprovePatterns: PermissionRule[];
    defaultAction: 'ask' | 'allow' | 'reject';
  };
}
```

### 5.2 Config Defaults

In `src/config.ts`, `permissions` defaults to:

```json
{
  "permissions": {
    "autoApprovePatterns": [],
    "defaultAction": "ask"
  }
}
```

This means: no auto-approve patterns, always ask the user. Fully backward-compatible.

## 6. Module: PermissionRules (`src/modules/permission-rules.ts`)

### Responsibility

Evaluate a `PermissionData` object against configured glob patterns. Return the auto-approve decision or `null` if user confirmation is needed.

### API

```typescript
export class PermissionRules {
  constructor(
    private rules: PermissionRule[],
    private defaultAction: 'ask' | 'allow' | 'reject'
  ) {}

  // Returns: 'once' | 'always' | 'reject' for auto-decision, null for "ask user"
  evaluate(permission: PermissionData): 'once' | 'always' | 'reject' | null;

  private matchRule(permission: PermissionData, rule: PermissionRule): boolean;
}
```

### Matching Logic

1. Iterate rules in order (first match wins)
2. If `permission.pattern` exists (OpenCode provides it), match against `rule.pattern` using minimatch
3. If `permission.pattern` does not exist, construct composite key `type:title` and match against `rule.pattern`
4. If no rule matches, apply `defaultAction`: `'allow'` → auto-approve once, `'reject'` → auto-reject, `'ask'` → return null

### Dependencies

- `minimatch` (new dependency) for glob pattern matching
- Or implement simple prefix/exact matching to avoid new dependency

### Config Example

```json
{
  "permissions": {
    "autoApprovePatterns": [
      { "pattern": "bash:git *", "response": "once" },
      { "pattern": "bash:ls *", "response": "once" },
      { "pattern": "read:*", "response": "always" }
    ],
    "defaultAction": "ask"
  }
}
```

## 6.1 Implementation Note: Event Type Names

The current codebase uses `session.status` with `status.type === 'idle'` to detect completion. However, the OpenCode Go SDK defines this event type as `session.idle` (not `session.status`). This discrepancy needs verification:

- **If OpenCode actually sends `session.status`**: Keep existing behavior, add `permission.updated` alongside
- **If OpenCode actually sends `session.idle`**: Update event type matching as part of this work

The EventProcessor will handle **both** patterns for safety:

```typescript
case 'session.idle':
case 'session.status': // fallback for older OpenCode versions
```

## 7. Module: EventProcessor (`src/modules/event-processor.ts`)

### Responsibility

Manage the OpenCode event processing lifecycle for a single `/run` invocation. State machine that handles text accumulation, permission requests, and completion.

### States

```
streaming --[permission.updated + no auto]--> waiting_permission
streaming --[permission.updated + auto]------> streaming (continues)
streaming --[session.idle]-------------------> done
streaming --[session.error]------------------> done
waiting_permission --[respondToPermission]---> streaming
```

### API

```typescript
export type EventProcessorCallbacks = {
  onText: (text: string) => void;
  onPermissionRequest: (perm: PermissionData) => void;
  onComplete: (text: string) => void;
  onError: (error: string) => void;
};

export class EventProcessor {
  constructor(
    private rules: PermissionRules,
    private client: OpenCodeClient,
    private sessionId: string,
    private callbacks: EventProcessorCallbacks,
  ) {}

  async handleEvent(event: OpenCodeEvent): Promise<void>;
  async respondToPermission(permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void>;
  get currentState(): 'streaming' | 'waiting_permission' | 'done';
  get currentText(): string;
}
```

### Event Handling

| Event | Action |
|---|---|
| `message.part.updated` | Extract text, append to accumulator, call `onText` |
| `permission.updated` | Evaluate via PermissionRules. Auto-match → call API directly. No match → set state, call `onPermissionRequest` |
| `session.idle` | Set state done, call `onComplete` with accumulated text |
| `session.error` | Set state done, call `onError` |
| All others | Ignore (no-op) |

## 8. Handler Changes

### 8.1 `handleRun` refactor

Extract event loop logic into EventProcessor. `handleRun` becomes:

1. Pre-checks (existing)
2. Create EventProcessor with callbacks
3. Store processor reference in `Map<qq, EventProcessor>` for `/approve` access
4. Subscribe to events, iterate, delegate to `processor.handleEvent()`
5. Cleanup on completion/abort

New field on `BridgeHandlers`:

```typescript
private activeProcessors = new Map<string, EventProcessor>();
```

### 8.2 `handlePermission` completion

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
    s.pendingPermissionId = null;
    s.state = 'running';
    return this.reply(qq, approve ? '✅ 已授权' : '❌ 已拒绝', isGroup, groupId);
  } catch (e) {
    return this.reply(qq, `授权失败: ${e instanceof Error ? e.message : String(e)}`, isGroup, groupId);
  }
}
```

## 9. Free Text Forwarding (`src/index.ts`)

When `parseCommand` returns null (non-command text), check session state:

```typescript
if (!parsed) {
  const session = sessions.getOrCreate(qq);
  // Only forward when session is actively running (OpenCode is streaming/waiting)
  if (session.state === 'running' && session.sessionId && session.projectPort) {
    const client = new OpenCodeClient(session.projectPort, config.opencode.password);
    try {
      await client.sendMessage(session.sessionId, normalized);
    } catch (e) {
      error('Free text forward failed', e);
    }
    return;
  }
  // Default: unknown command message
  await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
  return;
}
```

**Design decision**: Free text is only forwarded when state is `running` (OpenCode is actively processing and can accept follow-up messages). When state is `permission_pending`, the user must explicitly use `/approve` or `/reject` — free text could accidentally approve dangerous operations.

## 10. Error Handling

| Scenario | Handling |
|---|---|
| User sends `/run` while `permission_pending` | Reply "请先 /approve 或 /reject 当前权限请求" |
| User sends `/run` while `running` | Existing behavior: "当前有命令正在执行" |
| Permission timeout (no user response) | Uses existing `commandTimeout`, aborts entire session |
| `respondToPermission` API fails | Catch exception, notify user "授权失败", log error |
| Auto-approve API call fails | Log error, degrade to notifying user for manual confirmation |
| SSE disconnects during permission wait | Existing abort logic handles this |
| User sends `/approve` without pending permission | Reply "当前没有待确认的权限请求" |

## 11. Testing

### `tests/permission-rules.test.ts`

- Exact pattern match → correct response
- Glob pattern match (`bash:git *`) → matches `bash:git status`
- No match → returns null (ask user)
- Default action `allow` → returns 'once'
- Default action `reject` → returns 'reject'
- Empty rules list → falls through to default action
- First-match-wins when multiple rules could match

### `tests/event-processor.test.ts`

- `message.part.updated` accumulates text and fires `onText`
- `permission.updated` + auto-approve → calls API, does NOT fire `onPermissionRequest`
- `permission.updated` + no match → fires `onPermissionRequest`, state becomes `waiting_permission`
- `respondToPermission` → calls API, state returns to `streaming`
- `session.idle` → fires `onComplete` with accumulated text
- `session.error` → fires `onError`
- Unknown event type → no-op

### `tests/command.test.ts` (modify)

- Add test cases for `/approve` and `/reject` command parsing

### `tests/handlers.test.ts` (modify or new)

- `/approve` without pending permission → error message
- `/approve` with pending permission → calls API, state resets
- Free text during `running` state → forwarded to OpenCode
- Free text during `idle` state → "未知命令" message

## 12. Dependency Changes

- `minimatch` — for glob pattern matching in PermissionRules
  - Alternative: implement simple `*` wildcard matching without external dependency
  - Decision: Use `minimatch` for correctness. It's a small, well-tested library.

## 13. Migration / Rollout

1. Add `permissions` field to config with sensible defaults (empty patterns, `defaultAction: "ask"`)
2. Existing `config.json` files work without modification (defaults applied)
3. No command protocol changes — `/approve` and `/reject` already exist
4. Users can gradually add auto-approve patterns to their config
