# Git workflow & collaboration guide

Purpose: keep multiple human and agent contributors from stepping on each other's changes.

Recommended workflow (minimal friction):

- Branching: use feature branches with the pattern `feature/<short-desc>` or `fix/<short-desc>`.
- Pull Requests: open PRs against `main` (or `develop` if you have one). Describe the change and link issues.
- Code owners: `CODEOWNERS` is defined to route review requests automatically.
- Pre-commit hooks: run `pre-commit install` (see `scripts/setup-dev.sh`) to enable lint/format checks locally.

Agent-aware recommendations:

- Per-agent workdirs: agents should honor `KILO_AGENT_WORKDIR` (env var) and avoid writing to shared top-level files.
- File ownership: use `CODEOWNERS` and add clear module-level owners for critical code areas.
- Short-lived branches: keep branches small and focused to reduce merge conflicts.

Conflict avoidance tips:

- Use `git pull --rebase` before starting work to keep history linear.
- Run `pre-commit run --all-files` before committing to fix formatting issues.
- For large refactors coordinate in a brief design PR and consider feature flags.

Next steps (I can implement these):

- Add GitHub Actions or CI to run `pre-commit` and tests on PRs.
- Implement per-agent workdir support in runtime config and update `README` with env var details.
