Task: Add a parser regression test so `/commands` is parsed as a bridge command after the output refactor.

- Change: tests/command.test.ts updated to include test: 'parses commands bridge command'
- Validation: Run `npm test -- tests/command.test.ts -t "parses commands bridge command"` and ensure it passes

Notes:
- The repository already includes '/commands' in BRIDGE_COMMANDS according to inherited wisdom.
- This test ensures the parser continues to treat "/commands" as { type: 'bridge', command: 'commands', args: '' }.
