# DIRECTIVE_FOR_KILO

Purpose
-------
This file is an onboarding and safety directive for the `kilo` agent. It defines allowed work, forbidden actions, safe helper scripts, reporting formats, and example invocations so `kilo` can learn the compiler/tooling in a sandboxed, auditable way.

Allowed scope
-------------
- Read and run code only inside the repository under these directories:
  - `we/cuda_param_sweep/`
  - `scripts/`
  - `AGENT_UPDATES.md` and `TASKS/`
- Create outputs under `agent-results/kilo/` only.

Forbidden actions (hard rules)
-----------------------------
- DO NOT modify or remove `.git` or any `.git/*` metadata.
- DO NOT push, pull, or perform any `git` network operation (no `git push`/`git pull`/`gh` calls).
- DO NOT delete or move large directories outside `agent-results/kilo/`.
- DO NOT execute arbitrary shell commands outside the allowed runner scripts.

Safe helpers (use these, do not reinvent)
----------------------------------------
- `scripts/kilo-run-compile.sh <relative-path-to-source>` — compile sandbox, run short test, produce JSON result.
- `scripts/agent-update.sh <AgentName> <message...>` — append a timestamped entry to `AGENT_UPDATES.md` (use for status updates).

Reporting format (result JSON)
------------------------------
All runner outputs should write a JSON to `agent-results/kilo/<timestamp>/result.json` with these keys:

- `timestamp` (ISO8601 UTC)
- `agent` (string, e.g. "kilo")
- `source` (path relative to repo)
- `compile_status` ("ok"|"error")
- `compile_time_s` (float seconds)
- `compile_stdout` (string, trimmed)
- `compile_stderr` (string, trimmed)
- `binary_size_bytes` (int or null)
- `run_exit_code` (int)
- `run_stdout` (string, trimmed)
- `run_stderr` (string, trimmed)
- `artifacts` (array of relative paths)

How to behave (process rules)
-----------------------------
1. Use `scripts/kilo-run-compile.sh` for all compile/run tasks. It enforces path checks and timeouts.
2. After a successful run, call `scripts/agent-update.sh kilo "Compiled <path> → result: <short summary>"` to append a one-line status to `AGENT_UPDATES.md`.
3. If any unexpected error occurs, do NOT retry destructive actions; report the error to `AGENT_UPDATES.md` and stop.

Examples
--------
Compile `device_test.cu` and produce results:

scripts/kilo-run-compile.sh we/cuda_param_sweep/device_test.cu

This creates `agent-results/kilo/<timestamp>/result.json` and prints the JSON to stdout.

Notes for maintainers
---------------------
- Review `agent-results/kilo/` periodically and rotate or archive older runs.
- If you want `kilo` to be allowed additional directories, update this directive and confirm with a maintainer.
