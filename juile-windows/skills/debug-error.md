# Debug an error
1. Reproduce it: run the failing command/file with `shell` or `python` and read the FULL error.
2. Open the referenced file/line with `read_file`. Form one hypothesis.
3. Fix with `write_file` (one surgical change), then re-run to confirm. Loop until green.
4. State the root cause in one human sentence.
