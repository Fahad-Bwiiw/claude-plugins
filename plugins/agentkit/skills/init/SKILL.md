---
name: init
description: Generate a verified .agentkit.yml for this repository - the committed source of truth for test/lint/typecheck/security commands that every agentkit agent reads before doing anything else. Use when a repo has no .agentkit.yml yet, or when its commands are stale after a build system change.
---

# init: generate `.agentkit.yml`

`.agentkit.yml` is the third layer of agentkit's architecture: not policy
(what a good test is — `testing-policy`), not mechanics (how pytest vs
vitest vs nextest work — the `stack-*` skills), but the actual commands for
*this* repository. Every agentkit agent reads it first and must never guess a
command. This skill is how that file gets created and kept honest.

The single rule that matters more than any other: **every command written
into `.agentkit.yml` must be verified by actually running it once before it
goes in the file.** A wrong command doesn't fail loudly and get noticed — it
fails confidently, inside an agent's Step 0, in every future session, and
looks like a working setup until someone reads the output closely. Omitting
a key you can't verify is always better than guessing one.

## Procedure

### 1. Establish source-of-truth priority

Commands come from, in this order:

1. **CI config** (`.github/workflows/*.yml`, `.gitlab-ci.yml`,
   `.circleci/config.yml`). This is the actual command that gates merges in
   this repo today — the strongest evidence available, because it's already
   proven to run successfully in a clean environment.
2. **README / CONTRIBUTING docs.** Use only when CI doesn't cover a given
   command (e.g. CI runs `make ci` as one opaque target and the README
   documents what that expands to, or CI doesn't run a category at all, like
   `fmt` or a local-only `test_one` pattern).
3. **Inference from the build system** (`detect-stack.mjs`, or direct
   inspection of `package.json` scripts / `pyproject.toml` / `Cargo.toml`).
   Lowest priority — use it to find a *candidate* command, then verify it
   before trusting it at all.

Never skip straight to step 3. A repo's CI is doing something specific for a
reason (a particular flag, a particular subset of tests, a particular
working directory) that inference alone won't reproduce.

### 2. Read CI config first

Open every CI workflow file and extract the literal commands it runs for
test, lint, typecheck, format-check, and coverage. Note:

- The working directory each command runs from (a monorepo job that `cd`s
  into a subpackage first changes what `backend.root` should be).
- Any environment variables the command depends on (e.g. `CI=true` changing
  a tool's behavior, or a required `DATABASE_URL` for integration tests) —
  if a command only works with setup this skill can't reproduce locally,
  say so in a comment rather than writing a command that will fail for the
  next agent that tries it verified-in-CI-only.
- Matrix/multi-job setups: if backend and frontend run in separate jobs,
  that maps directly to `.agentkit.yml`'s `backend`/`frontend` split.

### 3. Fall back to inference where CI doesn't cover a key

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs"` (or read the
README) to get candidate commands for anything CI didn't already give you.
Treat every candidate as unverified until step 4.

### 4. Verify every command by running it once

For each candidate command (from any source, including ones lifted straight
from CI — CI config can be stale too):

- Run it in the repo root (or the `root` you're about to record).
- Confirm it exits the way you'd expect for a passing repo (test/lint/
  typecheck commands should exit 0 on a clean checkout; if the repo
  currently has failing tests or lint errors, that's fine — confirm the
  command *runs and reports*, not that it passes).
- For `test_one`, verify the templated form works against one real,
  currently-passing test — not just that the bare test command works.
- If a command errors out for a reason unrelated to the code (missing
  binary, missing env var, wrong working directory), do not write it into
  `.agentkit.yml`. Either fix the invocation and reverify, or omit the key.

**A command that hasn't been run in this session doesn't go in the file.**
This includes commands that "obviously" work by inspection — inspection is
exactly how wrong commands get written down.

### 5. Fill in `conventions`

- `test_paths`: the actual directory/glob pattern the existing test suite
  uses (`tests/`, `**/*.test.ts`, `src/**/*_test.rs` — whatever's really
  there), not a default guess.
- `rules`: repo-specific testing conventions worth an agent knowing that
  don't fit elsewhere — e.g. "integration tests require `docker compose up
  -d db` first," "snapshot tests live under `__snapshots__/` and are
  reviewed by a human before merge," "use the `factories/` module for test
  fixtures, not inline construction."

### 6. Set `min_diff_coverage` only if asked or already enforced

Don't invent a coverage threshold. If CI already enforces one (e.g. a
Codecov config or a `--cov-fail-under` flag), use that number. Otherwise
leave the key out rather than picking a number nobody asked for — that's a
policy decision for a human, not this skill.

### 7. Write the file and report what was skipped

Write `.agentkit.yml` at the repo root following the schema below. In your
final report, list every key you omitted and why (no evidence found, command
failed to verify, requires unavailable environment) — a silent omission
looks identical to "there was nothing to put there," and the two need
different follow-up.

## Schema

```yaml
version: 1

backend:
  language: python          # python | node | rust
  root: .                   # working directory for all backend commands
  test: uv run pytest
  test_one: "uv run pytest {test_id}"
  coverage: uv run pytest --cov --cov-report=term-missing
  lint: uv run ruff check .
  typecheck: uv run mypy .
  fmt: uv run ruff format --check .
  min_diff_coverage: 80     # optional; omit unless already enforced somewhere

frontend:
  language: node
  root: apps/web
  test: pnpm test
  test_one: "pnpm vitest run {test_file}"
  e2e: pnpm exec playwright test
  lint: pnpm lint
  typecheck: pnpm typecheck
  fmt: pnpm fmt
  min_diff_coverage: 80     # optional

security:
  sast: pnpm exec semgrep --config auto
  deps: pnpm audit --audit-level=high
  secrets: gitleaks detect --no-git -v
  iac: checkov -d infra/

conventions:
  test_paths:
    - backend/tests/**
    - apps/web/src/**/*.test.tsx
  rules:
    - "Integration tests require `docker compose up -d db` first."
    - "Use factories/ for test fixtures, not inline construction."
```

Every top-level section (`backend`, `frontend`, `security`, `conventions`) is
optional — a backend-only repo simply omits `frontend`. Within a section,
every key is optional; omit rather than guess.
