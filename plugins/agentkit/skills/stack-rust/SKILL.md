---
name: stack-rust
description: Rust testing mechanics - cargo test vs cargo nextest, mocking, coverage with llvm-cov, clippy/rustfmt. Load this on demand once a repo is identified as Rust, after testing-policy. Covers HOW to write and run a Rust test; testing-policy covers WHAT makes it good.
---

# Rust testing mechanics

This skill covers *how* Rust tests are written and run. What makes a test
good is defined by the `testing-policy` skill, which applies here unchanged.

Never guess the invocation for this repo. The commands to actually run
(`backend.test`, `backend.test_one`, `backend.coverage`, `backend.lint`,
`backend.fmt`) come from `.agentkit.yml` or, failing that,
`detect-stack.mjs` — see each agent's Step 0.

## `cargo test` vs `cargo nextest run`

- Both run the same `#[test]` functions; nextest is a separate test harness
  with a different process model (one process per test, run in parallel by
  default) and different output. If `.agentkit.yml` or `detect-stack.mjs`
  reports nextest as available (a `.config/nextest.toml` in the repo, or the
  `nextest` binary present), use it — it surfaces flaky/leaking tests that
  `cargo test`'s shared-process model can mask.
- Running a single test: `cargo test <name>` matches by substring across the
  whole binary, which can hit more than one test if names collide — prefer
  the fully qualified path (`cargo test module::tests::test_name`) or
  nextest's exact filter (`cargo nextest run -E 'test(exact_name)'`) when
  precision matters, e.g. inside the bounded fix-attempt loop.
- Integration tests under `tests/` each compile as a separate crate; unit
  tests in `#[cfg(test)] mod tests` inside `src/` share the binary they test.
  A test belongs in `tests/` when it should only see the crate's public API,
  and in an inline `#[cfg(test)]` module when it needs access to private
  items.

## Mocking and boundaries

- Rust has no built-in mocking; the idiomatic approach is a trait at the
  boundary (the HTTP client, the clock, the storage layer) with a real
  implementation and a test implementation, injected via generics or a
  `Box<dyn Trait>`. This is more setup than a dynamic-language mock but keeps
  the seam explicit and compiler-checked.
- `mockall` generates mock implementations from a trait via a derive macro
  when hand-writing a test double is heavy — reach for it once a trait has
  more than two or three methods worth mocking.
- For HTTP specifically, `wiremock` or `mockito` stand up a real local
  server your code talks to over the network, which — like MSW in the Node
  skill — exercises the real request-building path instead of mocking a
  client method.
- `tokio::time::pause()` / `advance()` for testing anything time-based in
  async code, instead of real sleeps — deterministic and instant.

## Coverage

- `cargo llvm-cov` (or `cargo tarpaulin` on older setups) reports line and
  region coverage. `cargo llvm-cov --html` for a browsable report,
  `cargo llvm-cov report --lcov` for CI-consumable output.
- As with the other stacks, diff coverage against `.agentkit.yml`'s
  `min_diff_coverage` is the meaningful gate — repo-wide percentage on a
  crate with a lot of generated or `unsafe`-heavy code is often
  structurally low without that being a problem.

## Lint and format

- **clippy** (`cargo clippy --all-targets -- -D warnings`) catches far more
  than the compiler alone — treat a new clippy warning on touched code as a
  real finding, not noise, unless it's pre-existing on an untouched line.
- **rustfmt** (`cargo fmt --check` to verify without rewriting) is close to
  non-negotiable in most Rust repos; don't hand-format around it.
- Doctests (`/// # Examples` blocks with fenced code) run under `cargo test`
  by default and count as real tests — don't mark one `ignore` to make a
  build pass without approval, same as any other test per the hard
  prohibitions.

## Workspaces

- In a Cargo workspace, `cargo test` / `cargo nextest run` from the
  workspace root runs every member crate by default. Scope to one crate with
  `-p <crate-name>` when iterating on a single failure inside the bounded
  fix-attempt loop, to keep each attempt fast.
