---
name: stack-node
description: Node/TypeScript testing mechanics - vitest/jest, Testing Library role-based queries, MSW at the network boundary, Playwright web-first assertions. Load this on demand once a repo is identified as Node/frontend, after testing-policy. Covers HOW to write and run a JS/TS test; testing-policy covers WHAT makes it good.
---

# Node / TypeScript testing mechanics

This skill covers *how* JS/TS tests are written and run, for both unit-level
(vitest/jest) and end-to-end (Playwright) work. What makes a test good is
defined by the `testing-policy` skill, which applies here unchanged.

Never guess the invocation for this repo. The commands to actually run
(`frontend.test`, `frontend.e2e`, `frontend.lint`, `frontend.typecheck`,
`frontend.fmt`) come from `.agentkit.yml` or, failing that,
`detect-stack.mjs` — see each agent's Step 0.

## Testing Library: query by role, not by implementation

- Query the way a user or assistive technology would:
  `getByRole('button', { name: /submit/i })`, `getByLabelText`,
  `getByPlaceholderText`, `getByText`. These fail when the accessible
  interface changes, which is exactly when you want a test to fail.
- Avoid `getByTestId` as a first choice. It's an escape hatch for the rare
  case a role/label/text query genuinely can't reach the element (e.g. a
  purely decorative node) — not a default. A `data-testid` query passes
  through a refactor that breaks the actual user-facing behavior.
- Avoid querying by CSS class or DOM structure entirely — both are
  implementation details the testing-policy skill already tells you to avoid
  coupling to.
- Use `userEvent` (not raw `fireEvent`) for interactions — it dispatches the
  full sequence of events a real user interaction produces (focus, keydown,
  input, etc.), which catches bugs `fireEvent.click` alone would miss.
- Prefer `findBy*` (async, retries until found or timeout) over `getBy*`
  wrapped in `waitFor` for anything that appears after an async update —
  it's the same behavior with less code.

## MSW at the network boundary

- Mock Service Worker intercepts at the network layer (`fetch`/`XHR`), not
  by mocking the module that calls `fetch`. This means the code under test
  exercises its real request-building logic, and the test breaks if that
  logic sends the wrong method, path, or body — not just if the response
  shape changes.
- Define handlers per-test or per-suite with `server.use(...)` for
  case-specific responses (errors, empty states, slow responses); keep a
  baseline handler set in a shared `handlers.ts` for the happy path so most
  tests don't restate it.
- Assert on the request MSW received (via `http.post(url, ({ request }) =>
  ...)`) when the test is specifically about what your code sends, not just
  what it does with the response.
- Never mock `fetch` or `axios` directly at the module level if MSW is
  already wired into the repo — that's two competing mocking strategies in
  one suite, and the testing-policy skill's boundary guidance says to mock
  at the seam, once.

## Playwright: web-first assertions

- Use Playwright's auto-retrying assertions (`expect(locator).toBeVisible()`,
  `.toHaveText()`, `.toHaveCount()`) instead of asserting on a value fetched
  once. Web-first assertions poll until the condition holds or the timeout
  elapses, which is what makes them race-condition-resistant by default.
- **Never use `page.waitForTimeout()`.** It is a fixed sleep with no
  relationship to the condition you actually care about — too short and the
  test flakes under load, too long and the suite is slow for no benefit.
  Replace it with a web-first assertion on the actual condition
  (`toBeVisible`, `toHaveURL`, a network response via
  `page.waitForResponse`, or `expect.poll` for an arbitrary predicate).
- Prefer `getByRole` / `getByLabel` locators here too, same reasoning as
  Testing Library above — Playwright's locator API is deliberately
  role-first.
- Use `test.step()` to break a long flow into named steps; it makes trace
  viewer output legible without changing test semantics.

## What not to write

- **No full-tree snapshots** (`toMatchSnapshot()` on an entire rendered
  component or page). They fail on any unrelated markup change, get
  regenerated with `-u` without being read, and stop meaning anything within
  a few PRs. If a snapshot is genuinely useful, scope it tightly (a single
  computed value, a small serialized object) so a diff is actually
  reviewable.
- No `act()`-wrapped manual timer manipulation as a substitute for a
  web-first assertion — same problem as `waitForTimeout`, just in unit tests
  instead of e2e.

## Coverage and types

- vitest/jest coverage (`--coverage`, typically via `c8` or `istanbul`)
  reports are read the same way as `pytest-cov`'s — line/branch, with diff
  coverage against `.agentkit.yml`'s `min_diff_coverage` mattering more than
  the repo-wide percentage.
- `tsc --noEmit` is the typecheck command in most repos; don't conflate it
  with the build — a repo can typecheck clean and still fail to bundle for
  unrelated reasons (and vice versa with `skipLibCheck` quirks).
