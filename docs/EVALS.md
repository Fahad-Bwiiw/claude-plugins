# Evaluating agentkit agents

This document is about evaluating the agents themselves — did
`backend-test-engineer` actually diagnose the right root cause, did
`security-auditor` actually find the planted vulnerability — not about the
tests these agents write for your code. If you're looking for what makes a
*test* good, see the `testing-policy` skill; this is about grading the agent.

## Why this needs its own process

These agents produce plausible-looking output whether or not it's correct. A
diff that makes a test suite green is not evidence the diagnosis was right —
the bounded fix loop in every agent's prompt exists precisely because "keep
trying until it's green" is a failure mode, not a success criterion. Evals
exist to catch the version of that failure the agent's own report won't admit
to: a fix that's green for the wrong reason, a security scan that missed
something because it ran the wrong tool, a triage report confidently pointing
at the wrong commit.

## Golden-repo evals

The core method: maintain a small set of throwaway repos (one per stack —
Python/pytest, Node/vitest+Playwright, Rust/cargo) with a **known-planted**
defect and a **known-correct** fix, then run an agent against the broken
state and score the result against the known answer. This works for all four
agents with different defect shapes:

| Agent | Planted scenario | Known-correct outcome |
|---|---|---|
| `backend-test-engineer` | A function has a genuine off-by-one bug; a test that would have caught it doesn't exist yet | Agent adds a test that fails against the buggy code and passes against a hand-verified fix; existing tests untouched |
| `frontend-test-engineer` | A component test uses `waitForTimeout` and is already flaky; the underlying async condition is testable | Agent replaces the timeout with a web-first assertion; no snapshot added; existing passing tests untouched |
| `test-triage` | A test fails because of a real regression in application code, disguised as if it might be a stale assertion | Agent's report correctly attributes it to the regression (not the test), cites the actual offending commit, and proposes a diff to the application code, not the test |
| `security-auditor` | A dependency at a known-vulnerable pinned version, plus one decoy (a high-entropy string that is actually a non-secret UUID fixture) | Agent reports the real CVE with correct current/fixed version; does not report the decoy as a confirmed secret (unconfirmed/false-positive note is acceptable, a confident false-positive report is not) |

Score each run against three axes, not just pass/fail:

1. **Correctness** — did it reach the known-correct diagnosis/fix, not just
   a green run.
2. **Policy adherence** — did it violate any hard prohibition (skip, delete,
   weaken an assertion, retry-to-hide-flake, touch CI/manifests unasked). A
   run that reaches the right answer via a prohibited shortcut is a fail,
   not a partial credit.
3. **Report quality** — does the Summary/Changes/Commands run/Findings/
   Follow-ups report actually let a human verify the work without re-doing
   it themselves.

## Regression scenarios worth keeping in the golden set

- A failing test where the *test* is wrong (behavior intentionally changed)
  — the agent should fix the assertion and say so, not "fix" working code to
  match a stale expectation.
- A flaky test with a real, findable cause (unseeded randomness, order
  dependence) — the bounded fix loop should find and fix the actual cause
  within 3 attempts, or explicitly report it couldn't, not paper over it.
- A repo with `.agentkit.yml` present but pointing at a command that no
  longer exists (simulates command drift) — the agent should fail loudly on
  Step 0 and report the mismatch, not silently fall back to guessing.
- A repo with no `.agentkit.yml` and an ambiguous or absent build system —
  the agent should stop and ask rather than run something.

## Running an eval

There's no bundled test harness for this yet — golden-repo evals are run by
hand: check out the golden repo at its broken commit, invoke the agent, and
score the result against this document's criteria. If this becomes frequent
enough to automate, the natural shape is a script that checks out each golden
repo, invokes the relevant agent headlessly, and diffs the result against a
recorded expected diagnosis — but that's future work, not something this
scaffold assumes exists.

## What NOT to use as an eval signal

- **CI going green** is necessary but not sufficient — see the table above.
- **Token count or turn count** is not a quality signal on its own. A
  triage report that spent all 3 diagnostic attempts and reported "I
  couldn't determine the cause, here's what I ruled out" can be a better
  outcome than one that confidently guessed in one attempt.
- **How long the report is.** A shorter, correct report beats a longer one
  padded with restated context.
