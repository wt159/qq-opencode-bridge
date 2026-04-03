# Commands output tests - notes

- Added two failing tests to tests/handlers.test.ts to verify /commands renderer behavior:
  - `returns compact commands list without descriptions` (compact rendering not yet implemented)
  - `returns empty command message when OpenCode exposes none`
- Tests mock OpenCode GET /command responses via a local HTTP server and bind a test QQ to a running OpenCode port.
- Current implementation is verbose for handleCommands(); tests are designed to fail until Task 4 (compact renderer) is completed.

Next steps:
- Implement compact renderer in src/modules/handlers.ts for handleCommands.
- Adjust tests to match new compact output once implemented.
- Run full test suite: npm test

- Status: Compact test expectation fixed to match target format: 可用命令（2 个）:\n- /oc init\n- /oc review
