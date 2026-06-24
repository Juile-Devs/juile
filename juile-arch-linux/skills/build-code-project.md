# Build a code project on the user's machine

Use when the user asks Juile to write or scaffold software.

1. Restate the goal and pick a minimal stack. State assumptions.
2. Plan files as a `steps` widget.
3. Create files with `write_file` (paths are relative to the workspace folder unless absolute).
4. Install deps and run with `shell` (PowerShell). Show the actual output.
5. If something fails, read the error, fix the file, and re-run — loop until it works.
6. Summarise what was built and exactly which files/commands were used.
