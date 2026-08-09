# bwiiw-agents

An internal Claude Code plugin marketplace. Right now it publishes one
plugin, `agentkit`: backend, frontend, and security testing agents for
Python, Rust, Node.js, and TypeScript repositories.

## Install

From any consumer repository:

```
/plugin marketplace add Fahad-Bwiiw/claude-plugins
/plugin install agentkit@bwiiw-agents
```

Or, to enable it automatically for everyone on a project without a manual
install step, commit a `.claude/settings.json` like
[`examples/consumer-repo/.claude/settings.json`](examples/consumer-repo/.claude/settings.json).
See that example for the `extraKnownMarketplaces` / `enabledPlugins` /
`permissions` shape, including a scoped `Bash` allowlist and a `deny` list
that blocks `git push` and reading `.env` files.

## Architecture

agentkit is built on a strict separation between three layers. Every agent
and skill in this plugin respects it, and if you extend the plugin, keep
respecting it — collapsing a layer is how you end up with a policy opinion
hardcoded next to a pytest flag, unable to reuse either one.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Policy — what a good test is                              │
│    skills/testing-policy/SKILL.md                             │
│    Stack-invariant. No pytest, no vitest, no cargo mentioned. │
├─────────────────────────────────────────────────────────────┤
│ 2. Mechanics — pytest vs vitest vs nextest                    │
│    skills/stack-python, skills/stack-node, skills/stack-rust  │
│    Loaded on demand once an agent knows the repo's language.  │
├─────────────────────────────────────────────────────────────┤
│ 3. Commands — how to test THIS repo                           │
│    .agentkit.yml, committed in the consumer repo               │
│    Agents read it first. They must never guess a command.     │
└─────────────────────────────────────────────────────────────┘
```

**Why split it this way.** A test-quality rule ("assert behavior, not
implementation") is true regardless of language, so it belongs in exactly
one place, not copy-pasted into three stack skills that will drift out of
sync. A runner-specific idiom ("use `tmp_path`, not a hardcoded path") is
true regardless of which repo you're in, so it belongs in a stack skill, not
repeated per-repo. But no command is safely inferable in general — the same
`pyproject.toml` might run tests through `make test`, `tox`, or straight
`pytest` depending on the repo — so the actual invocation has to live with
the repo that defines it, verified once, not guessed per session.

`detect-stack.mjs` exists only as the fallback for the third layer, for a
repo that hasn't run the `init` skill yet. It's a zero-dependency Node ESM
script (no `npm install`, since Claude Code already requires a Node runtime
to run at all — this is what lets it work unmodified in a pure Python or
Rust repo). It never emits a command it can't back with a file it actually
found; see [`plugins/agentkit/scripts/detect-stack.mjs`](plugins/agentkit/scripts/detect-stack.mjs).

## Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| `backend-test-engineer` | sonnet, high effort | Read, Write, Edit, Grep, Glob, Bash | Writes and fixes backend tests (Python/Rust/Node) |
| `frontend-test-engineer` | sonnet, high effort | Read, Write, Edit, Grep, Glob, Bash | Writes and fixes frontend tests: Testing Library role-based queries, MSW at the network boundary, Playwright web-first assertions |
| `test-triage` | opus, high effort | Read, Grep, Glob, Bash (no write tools) | Diagnoses root cause of a failure and proposes a diff; never applies it |
| `security-auditor` | sonnet, high effort | Read, Grep, Glob, Bash (no write tools) | Runs SAST/dependency/secrets/IaC scans and reports findings; never patches |

Every agent:

- Resolves its environment the same way at Step 0: read `.agentkit.yml`,
  else run `detect-stack.mjs`, else stop and ask rather than guess.
- Follows the same hard prohibitions: never delete a test, never mark one
  skipped, never weaken an assertion, never add a retry to hide a flake,
  never touch CI config or dependency manifests unless asked.
- Runs a bounded loop: at most 3 fix (or diagnostic, or verification)
  attempts per distinct failure, then stops and reports rather than
  looping indefinitely.
- Reports back in the same shape: **Summary / Changes / Commands run /
  Findings / Follow-ups.**

That consistency is deliberate — a human reviewing four different agents'
output shouldn't have to learn four different report formats to know where
to look for the part that needs a decision.

## Skills

- **`testing-policy`** — the policy layer. Preloaded into
  `backend-test-engineer`, `frontend-test-engineer`, and `test-triage`.
- **`stack-python`, `stack-node`, `stack-rust`** — the mechanics layer.
  Loaded on demand once an agent knows the repo's language; deliberately not
  preloaded, since a Python-only repo shouldn't pay for Rust-specific
  context.
- **`security-scan`** — mechanics for SAST/dependency/secrets/IaC scanners.
  Preloaded into `security-auditor`.
- **`init`** — the procedure for generating a repo's `.agentkit.yml`. Run it
  once per repo (or after a build-system change makes the existing file
  stale). It insists on verifying every command by actually running it
  before writing it down — see
  [`plugins/agentkit/skills/init/SKILL.md`](plugins/agentkit/skills/init/SKILL.md)
  for why that's non-negotiable.

## `.agentkit.yml`

Commit this in every repo that installs agentkit. See
[`examples/consumer-repo/.agentkit.yml`](examples/consumer-repo/.agentkit.yml)
for a full worked example (mixed Python backend + React frontend monorepo),
and the `init` skill for how to generate one. Schema:

```yaml
version: 1
backend:
  language: python | node | rust
  root: .
  test: ...
  test_one: "... {test_id}"
  coverage: ...
  lint: ...
  typecheck: ...
  fmt: ...
  min_diff_coverage: 80        # optional
frontend:
  language: node
  root: .
  test: ...
  e2e: ...
  lint: ...
  typecheck: ...
  fmt: ...
  min_diff_coverage: 80        # optional
security:
  sast: ...
  deps: ...
  secrets: ...
  iac: ...
conventions:
  test_paths: [...]
  rules: [...]
```

Every top-level section is optional; every key within a section is optional.
Omitting a key an agent needs makes it stop and ask, which is the intended
failure mode — a wrong guess is worse than a pause.

## CI integration

[`examples/consumer-repo/.github/workflows/agentkit-security-review.yml`](examples/consumer-repo/.github/workflows/agentkit-security-review.yml)
runs `security-auditor` against every pull request and posts its findings as
a comment. It is **advisory, never a required status check** — see the
comment at the top of that file for why: LLM output isn't reproducible, so a
required agent check means a content-free re-run can flip a merge decision,
and the team learns to re-run until green instead of reading the result.
Deterministic scanners (the ones in `.agentkit.yml`'s `security` section)
are what should gate a merge; this workflow triages and comments.

## Evaluating the agents

See [`docs/EVALS.md`](docs/EVALS.md) for how to evaluate whether these
agents are actually doing their job well — golden-repo scenarios with known
answers, scored on correctness, policy adherence, and report quality, not
just "did the build go green."
