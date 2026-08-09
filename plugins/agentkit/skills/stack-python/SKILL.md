---
name: stack-python
description: Python testing mechanics - pytest idioms, fixtures, mocking, coverage, ruff/mypy. Load this on demand once a repo is identified as Python, after testing-policy. Covers HOW to write and run a Python test; testing-policy covers WHAT makes it good.
---

# Python testing mechanics

This skill covers *how* Python tests are written and run. What makes a test
good is defined by the `testing-policy` skill, which applies here unchanged —
this skill only adds the pytest-specific vocabulary for applying it.

Never guess the invocation for this repo. The commands to actually run
(`backend.test`, `backend.test_one`, `backend.coverage`, `backend.lint`,
`backend.typecheck`, `backend.fmt`) come from `.agentkit.yml` or, failing
that, `detect-stack.mjs` — see each agent's Step 0. This skill tells you what
those commands do and how to write code that passes them, not what to type.

## pytest idioms

- **Fixtures over setup/teardown.** Use `@pytest.fixture` for shared state,
  scoped (`function`, `class`, `module`, `session`) to the narrowest scope
  that's still correct. A `session`-scoped fixture that mutates state is a
  cross-test coupling bug waiting to happen — keep mutable fixtures at
  `function` scope.
- **Parametrize instead of looping.** `@pytest.mark.parametrize` gives each
  case its own test ID and failure output; a `for` loop inside a test
  collapses all cases into one pass/fail and stops at the first failure.
- **`tmp_path` / `tmp_path_factory`** for anything touching the filesystem.
  Never write to a hardcoded path or the repo directory itself.
- **`monkeypatch`** for environment variables, `sys.path`, and attribute
  patching — it undoes itself automatically at teardown, unlike manual
  patch/restore.
- **`pytest.raises`** for expected exceptions, with a `match=` regex when the
  message matters, so the test still fails if the *wrong* exception with the
  right type is raised.
- Avoid `assert` on floating point equality; use `pytest.approx`.

## Mocking and boundaries

- `unittest.mock.patch` (or `pytest-mock`'s `mocker` fixture) at the seam
  where your code calls out — an HTTP client, a DB driver, a third-party SDK
  — not at the seam of the function under test.
- Prefer dependency injection (pass the client/clock/random source in) over
  patching module globals where the codebase already supports it; it's more
  legible and survives refactors better.
- For HTTP boundaries specifically, prefer a fixture-based fake transport
  (e.g. `respx` for `httpx`, `responses` for `requests`) over patching
  individual methods — it validates the actual request shape, not just that
  a call happened.

## Coverage

- `coverage.py` (via `pytest-cov`) reports line and branch coverage. Prefer
  `--cov-report=term-missing` so uncovered lines are visible without opening
  an HTML report.
- Branch coverage catches untested `if`/`else` arms that line coverage
  misses — if `.agentkit.yml` doesn't specify, prefer `--cov-branch` when
  proposing a coverage command to add.
- Diff coverage (coverage restricted to changed lines) is what
  `min_diff_coverage` in `.agentkit.yml` refers to. Full-repo coverage
  percentage is not the same metric and shouldn't be used to satisfy it.

## Lint, format, types

- **ruff** covers both linting and formatting in most modern repos
  (`ruff check`, `ruff format`); older repos may separate **flake8** (lint)
  and **black** (format). Check which is actually configured before assuming.
- **mypy** for static types. A test file failing `mypy` because a mock's
  return type isn't annotated is a real finding, not noise — annotate the
  mock's spec (`create_autospec(SomeClass, spec_set=True)`) rather than
  ignoring the line.

## Common project layouts

- `tests/` mirroring `src/<package>/` is the common convention; a bare
  `test_*.py` next to the module it tests is also common in smaller repos.
  Check `.agentkit.yml`'s `conventions.test_paths` first; if absent, match
  whatever layout the existing test suite already uses rather than
  introducing a second convention.
- `conftest.py` holds fixtures shared across a directory tree — check the
  nearest one before writing a fixture that might already exist upstream.
