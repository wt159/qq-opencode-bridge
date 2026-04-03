# `/commands` Compact Output Plan

## TL;DR
> **Summary**: Simplify `/commands` so QQ receives a compact command-name list instead of full OpenCode descriptions, while still safely handling long command lists by splitting on line boundaries.
> **Deliverables**:
> - Compact `/commands` rendering with names only
> - Empty-list response for OpenCode instances with no commands
> - Automatic multi-message chunking for long command lists
> - Regression tests for parser stability and handler output
> **Effort**: Short
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

## Context
### Original Request
- `/commands` 返回的 OpenCode 命令太长，需要精简。

### Interview Summary
- User selected default output: **only command names**.
- Approved design: first-line summary + `- /oc <name>` rows + automatic line-safe chunking only when necessary.
- `/oc` protocol itself must remain unchanged.

### Metis Review (gaps addressed)
- Guardrail: do **not** add new paging commands such as `/commands next`.
- Guardrail: preserve OpenCode API order; do not sort or regroup commands.
- Guardrail: cover empty-list and long-list behavior explicitly.
- Guardrail: keep scope limited to display strategy for `/commands`.

## Work Objectives
### Core Objective
Make `/commands` chat output short and stable in QQ while preserving the full OpenCode command set.

### Deliverables
- `/commands` default response format changed to compact mode.
- Long outputs are automatically split into multiple QQ messages without splitting a command line.
- Empty command list returns a dedicated user-facing message.
- Tests prove compact output, empty list, and chunking behavior.

### Definition of Done (verifiable conditions with commands)
- `npm run typecheck` passes.
- `npm test` passes.
- `tests/command.test.ts` contains a `/commands` parser regression.
- `tests/handlers.test.ts` contains handler tests for compact output, empty list, and long-list chunking.

### Must Have
- `/commands` header text must be `可用命令（N 个）:` for the first message.
- Command rows must be rendered exactly as `- /oc <name>`.
- Description text from OpenCode must be omitted completely.
- Output order must match `OpenCodeClient.listCommands()` return order.
- Empty list text must be exactly `当前实例没有可用命令`.
- Chunking must be line-safe and automatic.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT change `/oc` command routing or `OpenCodeClient.listCommands()` API contract.
- Must NOT add `/commands next`, `/commands full`, or any new user-visible command flags.
- Must NOT introduce config knobs for this change.
- Must NOT sort, categorize, or summarize commands beyond removing descriptions.
- Must NOT split a single command line across two QQ messages.

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: tests-after using Vitest
- QA policy: Every task includes agent-executed verification
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> This change is intentionally sequential because parser regression, handler tests, and renderer implementation all touch the same narrow command path.

Wave 1: parser and handler test scaffolding
Wave 2: compact renderer and line-safe chunking implementation
Wave 3: full regression verification

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2, 3, 4 |
| 2 | 1 | 4 |
| 3 | 2 | 4 |
| 4 | 1, 2, 3 | F1-F4 |

### Agent Dispatch Summary (wave → task count → categories)
| Wave | Task Count | Categories |
|------|------------|------------|
| 1 | 1 | quick |
| 2 | 2 | quick |
| 3 | 1 | quick |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Lock `/commands` parser and route regression

  **What to do**: Add a parser regression so `/commands` continues to parse as a bridge command after the output refactor. Keep the existing route in `src/index.ts` unchanged; this task is about preventing accidental regression while the handler output is simplified.
  **Must NOT do**: Do not change command semantics, help wording, or add new command variants.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: single parser-focused test addition in existing test style
  - Skills: `[]` — no extra skill required during execution
  - Omitted: `['writing-plans']` — implementation task, not planning

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4 | Blocked By: none

  **References**:
  - Pattern: `tests/command.test.ts` — existing command parser regression style
  - Pattern: `src/modules/command.ts` — `BRIDGE_COMMANDS` and `parseCommand()` behavior
  - Pattern: `src/index.ts` — existing `commands` route should remain untouched
  - Contract: `AGENTS.md` — command semantic changes require parser + handler coverage

  **Acceptance Criteria**:
  - [ ] `tests/command.test.ts` contains a regression named `parses commands bridge command`
  - [ ] The test expects `/commands` to parse to `{ type: 'bridge', command: 'commands', args: '' }`
  - [ ] `npm test -- tests/command.test.ts -t "parses commands bridge command"` passes

  **QA Scenarios**:
  ```
  Scenario: Parser keeps /commands as bridge command
    Tool: Bash
    Steps: Run `npm test -- tests/command.test.ts -t "parses commands bridge command"`
    Expected: Vitest reports 1 passing test and 0 failures for the targeted case
    Evidence: .sisyphus/evidence/task-1-commands-parser.txt

  Scenario: Existing /oc parsing stays intact
    Tool: Bash
    Steps: Run `npm test -- tests/command.test.ts -t "parses OpenCode command"`
    Expected: Existing `/oc` parser regression still passes
    Evidence: .sisyphus/evidence/task-1-commands-parser-regression.txt
  ```

  **Commit**: NO | Message: `test(commands): lock parser regression` | Files: `tests/command.test.ts`

- [x] 2. Add failing handler tests for compact and empty `/commands` output

  **What to do**: Extend `tests/handlers.test.ts` with handler-level coverage for two exact behaviors: compact output for a short command list, and the empty-list message when OpenCode returns no commands. Reuse the existing NapCat mock and a lightweight mock OpenCode HTTP server pattern already used in handler tests.
  **Must NOT do**: Do not implement renderer changes in this task; tests should fail against current verbose behavior first.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: focused handler-level test additions in one file
  - Skills: `[]` — no extra skill required during execution
  - Omitted: `['subagent-driven-development']` — scope is too small

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 4 | Blocked By: 1

  **References**:
  - Pattern: `tests/handlers.test.ts` — current `MockNapCatService` and mock OpenCode server usage
  - API: `src/services/opencode.ts` — `listCommands()` reads `GET /command`
  - Handler: `src/modules/handlers.ts` — `handleCommands()` is the only formatter to change
  - Delivery: `src/services/napcat.ts` — replies are emitted as plain text message segments

  **Acceptance Criteria**:
  - [ ] A handler test named `returns compact commands list without descriptions` exists
  - [ ] That test expects a single QQ message shaped like:
        `可用命令（2 个）:\n- /oc init\n- /oc review`
  - [ ] A handler test named `returns empty command message when OpenCode exposes none` exists
  - [ ] That test expects exact text `当前实例没有可用命令`
  - [ ] Running the new targeted tests fails before implementation and passes after implementation

  **QA Scenarios**:
  ```
  Scenario: Compact list omits descriptions
    Tool: Bash
    Steps: Run `npm test -- tests/handlers.test.ts -t "returns compact commands list without descriptions"`
    Expected: Test passes only when output contains names only and no description text
    Evidence: .sisyphus/evidence/task-2-commands-compact.txt

  Scenario: Empty list shows dedicated message
    Tool: Bash
    Steps: Run `npm test -- tests/handlers.test.ts -t "returns empty command message when OpenCode exposes none"`
    Expected: Test passes only when exact empty-list wording is used
    Evidence: .sisyphus/evidence/task-2-commands-empty.txt
  ```

  **Commit**: NO | Message: `test(commands): cover compact and empty output` | Files: `tests/handlers.test.ts`

- [x] 3. Add failing handler test for long-list automatic chunking

  **What to do**: Add a handler test that mocks many OpenCode commands and verifies `handleCommands()` sends multiple NapCat messages when output would exceed the chunk cap. Lock the implementation contract now: max rendered text per QQ message = **3000 characters**, split only on line boundaries, preserve command order, and use `可用命令（第X/Y段，共N个）:` as the header for chunk 2+ while the first chunk remains `可用命令（N 个）:`.
  **Must NOT do**: Do not introduce paging commands, config-driven limits, or any command descriptions.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: one additional high-signal regression around message splitting
  - Skills: `[]` — no extra skill required during execution
  - Omitted: `['artistry']` — no unconventional approach needed

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 4 | Blocked By: 2

  **References**:
  - Pattern: `tests/handlers.test.ts` — same mock harness as Task 2
  - Handler: `src/modules/handlers.ts` — future chunking helper lives here
  - Delivery: `src/services/napcat.ts` — multiple `sendPrivateMsg` calls are valid output

  **Acceptance Criteria**:
  - [ ] A handler test named `splits long commands list into multiple messages on line boundaries` exists
  - [ ] The test asserts more than one outbound NapCat message was captured
  - [ ] Every captured message begins with either `可用命令（N 个）:` or `可用命令（第X/Y段，共N个）:`
  - [ ] No captured message contains a truncated `- /oc <name>` line fragment
  - [ ] Combined text across all chunks preserves original command order

  **QA Scenarios**:
  ```
  Scenario: Long command list auto-splits safely
    Tool: Bash
    Steps: Run `npm test -- tests/handlers.test.ts -t "splits long commands list into multiple messages on line boundaries"`
    Expected: Test passes only when output is split across multiple messages without breaking line boundaries
    Evidence: .sisyphus/evidence/task-3-commands-chunking.txt

  Scenario: No new paging command introduced
    Tool: Bash
    Steps: Run `npm test -- tests/command.test.ts`
    Expected: No parser changes are required; the suite passes with no `/commands next`-style additions
    Evidence: .sisyphus/evidence/task-3-commands-no-new-syntax.txt
  ```

  **Commit**: NO | Message: `test(commands): cover long list chunking` | Files: `tests/handlers.test.ts`

- [x] 4. Implement compact `/commands` renderer and chunk helper

  **What to do**: Update `src/modules/handlers.ts` so `handleCommands()` does the following exactly:
  1. Fetch `cmds = await client.listCommands()`.
  2. If `cmds.length === 0`, reply `当前实例没有可用命令`.
  3. Render command lines only as `- /oc ${name}` in the same order returned by OpenCode.
  4. Build the first chunk header as `可用命令（${cmds.length} 个）:`.
  5. Use a local helper inside `BridgeHandlers` (private method or local function) to split the final lines into message chunks of at most **3000 characters** each, counting the header text in the chunk length.
  6. For chunk 2 and later, prepend `可用命令（第${index}/${total}段，共${cmds.length}个）:`.
  7. Send each chunk as a separate reply in order.
  8. Omit every description field even if OpenCode returns one.
  **Must NOT do**: Must not touch `src/services/opencode.ts`, `src/index.ts`, or parser logic unless needed to satisfy tests; must not add config or user-visible flags.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: one handler implementation file with existing test harness
  - Skills: `[]` — no extra skill required during execution
  - Omitted: `['systematic-debugging']` — use only if the new tests fail unexpectedly

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: F1-F4 | Blocked By: 1, 2, 3

  **References**:
  - Pattern: `src/modules/handlers.ts` — existing `reply()` method and `handleCommands()` implementation
  - Pattern: `tests/handlers.test.ts` — expected outbound NapCat message shape
  - Contract: `src/services/opencode.ts` — `listCommands()` returns `{ name, description? }[]`
  - Contract: `AGENTS.md` — avoid changing command protocol; keep tests updated with semantic changes

  **Acceptance Criteria**:
  - [ ] `handleCommands()` no longer renders description text
  - [ ] Short command lists produce exactly one QQ message
  - [ ] Long command lists produce multiple QQ messages with deterministic headers
  - [ ] Empty command lists produce exactly `当前实例没有可用命令`
  - [ ] `npm run typecheck` passes
  - [ ] `npm test` passes

  **QA Scenarios**:
  ```
  Scenario: Full command regression suite passes
    Tool: Bash
    Steps: Run `npm test -- tests/command.test.ts tests/handlers.test.ts`
    Expected: All parser and handler tests pass, including the new /commands cases
    Evidence: .sisyphus/evidence/task-4-commands-suite.txt

  Scenario: Whole project verification passes
    Tool: Bash
    Steps: Run `npm run typecheck && npm test`
    Expected: TypeScript emits no errors and Vitest passes fully
    Evidence: .sisyphus/evidence/task-4-project-verification.txt
  ```

  **Commit**: NO | Message: `feat(commands): compact and chunk /commands output` | Files: `src/modules/handlers.ts`, `tests/command.test.ts`, `tests/handlers.test.ts`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high
- [x] F4. Scope Fidelity Check — deep

  **What to verify**: Confirm the change stayed narrow and did not accidentally alter unrelated command handling.
  **Tool/Agent**: deep
  **Steps**:
  1. Inspect changed files for unrelated behavioral edits outside `/commands`.
  2. Verify parser/routing for `/oc`, `/bind`, `/run`, and `/status` remain unchanged in behavior.
  3. Confirm no new user-facing commands, flags, or configuration keys were added.
  **Expected**: Reviewer approves that scope remained limited to `/commands` output simplification.
  **Evidence**: `.sisyphus/evidence/f4-scope-fidelity.md`

## Commit Strategy
- Use one final commit after verification and explicit user approval.
- Recommended final commit message: `feat(commands): simplify and chunk command list output`

## Success Criteria
- `/commands` is visibly shorter by default because descriptions are removed.
- Long command lists no longer flood a single oversized QQ message.
- No command order changes are introduced.
- `/oc` execution behavior remains unchanged.
- Regression tests fail if a future change reintroduces verbose descriptions or removes chunking.
