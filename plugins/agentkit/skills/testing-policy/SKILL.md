---
name: testing-policy
description: Stack-invariant policy for what makes a good test, a good fix, and a good test-related report. Preloaded into every agentkit test agent regardless of language. Use this to judge test quality and scope before writing or evaluating any test, no matter which stack it's written in.
---

# Testing policy

This skill defines what a good test is. It says nothing about *how* to run one —
that's the job of the `stack-python`, `stack-node`, and `stack-rust` skills,
loaded on demand once the language for this repo is known. This skill applies
identically whether the code under test is Python, TypeScript, or Rust.

Layering matters here: this policy is stack-invariant on purpose, so it never
mentions a specific test runner, assertion library, or CLI flag. If you find
yourself wanting to name one in this file, that content belongs in a `stack-*`
skill instead.

## What a good test asserts

- **Behavior, not implementation.** A test should survive a refactor that
  preserves behavior. If renaming a private helper or reordering internal
  calls breaks the test, the test is coupled to implementation, not behavior.
- **One reason to fail.** Each test should have a single, nameable reason it
  could go red. Tests that assert five unrelated things fail unhelpfully and
  get skipped under time pressure instead of read.
- **The failure message should tell you what broke without opening the test
  file.** Prefer specific assertions (`assert response.status == 404`) over
  generic ones (`assert response.ok is False`) that pass for the wrong reason.
- **No conditional assertions.** A test containing `if`/`else` around an
  assertion is testing two things badly instead of one thing well. Split it.
- **Determinism.** A test that depends on wall-clock time, network ordering,
  unseeded randomness, or ambient global state is not done — it is a future
  flake. Fix the source of nondeterminism (inject a clock, seed the RNG, mock
  the boundary) rather than adding a tolerance or a retry.
- **Independence.** Tests must not depend on execution order or on state left
  behind by another test. If test B only passes after test A has run, that's
  a shared-state bug to fix, not a fixture ordering to document.

## Test boundaries

- Prefer testing at the boundary a caller actually depends on: a public
  function, an API endpoint, a rendered UI state — not a private method three
  layers down.
- Mock or fake at architectural seams (the network, the filesystem, the
  clock, a third-party SDK), not at the boundary of the unit you're actually
  trying to verify. A test that mocks the function it's testing proves
  nothing.
- Prefer one narrow integration test over a network of unit tests that all
  assert the same wiring works, when the wiring itself is what's in question.

## What a good fix looks like

When a test is failing and the root cause is a genuine bug in the code under
test, fix the code, not the test. When the root cause is that the test's
expectation was wrong (the code's new behavior is correct and intended),
update the assertion to match — but say so explicitly in the report; don't
silently loosen it.

Never resolve a failure by making the test less capable of catching the
failure in the future. That includes every item in the hard prohibitions each
agent's system prompt lists (no deleting, no skipping, no weakening
assertions, no retries to hide flakes). This policy is why those prohibitions
exist: a test suite's value is exactly its ability to fail when something is
wrong, and every one of those shortcuts spends that value to make a build
green today.

## Coverage judgment

- New behavior needs a new test. A bug fix needs a regression test that fails
  against the old code and passes against the fix — write it against the old
  code first if you can, to prove it would have caught the bug.
- Don't chase coverage percentage for its own sake. A test that executes a
  line without asserting anything meaningful about its output inflates
  coverage and catches nothing. If `.agentkit.yml` sets
  `min_diff_coverage`, treat it as a floor to check against, not a target to
  write toward.
- Edge cases worth a test: empty input, the boundary value itself (not just
  values on either side), the largest realistic input, and the specific
  failure mode a bug report described. Don't enumerate every possible input
  combinatorially — that's what property-based testing is for, and only when
  the stack skill says the repo already uses it.

## Naming and structure

- Test names should describe the scenario and the expected outcome, not the
  method under test restated (`test_foo` tells a reader nothing;
  `test_withdraw_rejects_amount_over_balance` does).
- Arrange/Act/Assert (or Given/When/Then) as a structural default: setup,
  the one action under test, then assertions. Resist interleaving them.
- Shared setup belongs in a fixture or helper only once at least two tests
  need it identically. Before that, duplication is more readable than a
  premature abstraction.
