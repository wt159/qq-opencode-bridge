Test: splittng long commands list into multiple NapCat messages

- Added a new test in tests/handlers.test.ts that mocks /command to return 210 commands.
- Test asserts that handleCommands triggers more than one NapCat message and that headers start with 可用命令（ or 可用命令（第X/Y段，共N个）:
- Test currently fails because chunking logic is not implemented yet in handleCommands.
- Cleanup: removed all as any casts and trailing whitespace from the test, using proper type narrowing for NapCat messages.
- No comments/docstrings added to test file.
- Plan: implement chunking at 3000 chars per message and ensure order preservation across chunks.
