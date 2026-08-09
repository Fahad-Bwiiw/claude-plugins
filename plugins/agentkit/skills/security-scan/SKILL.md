---
name: security-scan
description: Mechanics for running and reading SAST, dependency, secrets, and IaC scanners across Python, Node, and Rust repos. Preloaded into the security-auditor agent. Covers HOW to scan and interpret results; it does not decide policy about what's a mergeable risk - that's a human call the agent's report supports, not replaces.
---

# Security scanning mechanics

This skill covers how to run and read security scanners. It doesn't set
policy about acceptable risk — that's a human judgment the audit report
informs. The `security-auditor` agent's job is to run the right tool for what
`.agentkit.yml`'s `security` section (or `detect-stack.mjs`'s language
detection, as a fallback) says this repo is, and report findings clearly
enough that a human can triage them fast.

Never guess a scan command. `.agentkit.yml`'s `security.sast`,
`security.deps`, `security.secrets`, and `security.iac` keys are the source
of truth; see the agent's Step 0. This skill tells you what each category of
tool looks for and how to read its output, not what to type.

## SAST (static analysis for code-level vulnerabilities)

- **Python**: `bandit` (targeted at common Python vulnerability patterns —
  shell injection, hardcoded credentials, weak crypto, unsafe deserialization)
  or `semgrep` with a language-appropriate ruleset.
- **Node/TypeScript**: `semgrep`, or ESLint with a security plugin
  (`eslint-plugin-security`) if that's what's already wired into the repo's
  lint config.
- **Rust**: memory safety is largely a non-issue inside safe Rust; focus
  SAST attention on `unsafe` blocks (grep for `unsafe` and read every hit —
  there's no tool substitute for reviewing unsafe code by hand) and on
  `cargo-geiger` for a quantified view of unsafe usage across dependencies.
- Read findings by severity, then by whether the flagged code path is
  reachable from untrusted input. A SAST tool cannot know your trust
  boundaries — a "high severity" finding in a CLI tool that only ever
  processes its author's own config file is a different risk than the same
  finding in a request handler.

## Dependency scanning (known-vulnerable versions)

- **Python**: `pip-audit` (queries the PyPA advisory database) or `safety`.
  Works against `requirements.txt`/`pyproject.toml`/`uv.lock`.
- **Node**: `npm audit` (or the `pnpm audit` / `yarn audit` equivalent
  matching whatever package manager `.agentkit.yml` names) against the
  lockfile actually committed — auditing `package.json` alone misses
  transitive pins.
- **Rust**: `cargo audit` against `Cargo.lock`, backed by the RustSec
  advisory database.
- A dependency finding is actionable only if a fix version exists and is
  compatible with the repo's version constraints. Report the current
  version, the vulnerable range, and the first fixed version explicitly —
  don't just paste a CVE ID and expect a human to look it up.
- Distinguish direct from transitive dependencies in the report. A vulnerable
  transitive dependency often needs a lockfile bump, not a manifest edit —
  and per the hard prohibitions, dependency manifest edits need explicit
  sign-off before this agent makes them.

## Secrets scanning

- `gitleaks` or `trufflehog` for scanning the working tree and, where asked,
  git history for committed credentials, API keys, and private key material.
- A secrets scanner's false-positive rate is nontrivial — a 40-character hex
  string that's actually a git commit SHA or a test fixture UUID will trip
  entropy-based detectors. Verify a hit by checking what the string is
  actually used for before reporting it as a real secret; note in the report
  when something is a plausible false positive rather than silently dropping
  it.
- A confirmed real secret found in history (not just the working tree) is
  not fixable by deleting the file in a new commit — the value is still
  reachable in prior commits. Report this distinction explicitly: rotation
  of the credential is required regardless of what happens to the code, and
  history rewriting is a separate, higher-blast-radius decision for a human
  to make, not this agent.

## IaC scanning

- `checkov` or `tfsec`/`trivy config` for Terraform, CloudFormation, and
  Kubernetes manifests — misconfigured public storage buckets, overly broad
  IAM policies, containers running as root, missing encryption-at-rest.
- IaC findings are usually about default posture, not a specific exploit —
  report them as hardening recommendations with the specific resource and
  attribute, not as active incidents, unless there's separate evidence
  (e.g. a genuinely public bucket) that the misconfiguration is live.

## Reading and prioritizing results across tools

- Dedupe: the same underlying issue often surfaces from two tools (e.g. a
  SAST hardcoded-secret rule and a dedicated secrets scanner both flagging
  the same string). Report it once, noting both sources.
- Order findings by exploitability and blast radius, not raw tool severity
  labels — tool severities aren't calibrated against each other and a
  "medium" from one scanner can matter more than a "high" from another.
- A scanner exiting non-zero because it found findings is expected behavior,
  not a tooling failure — don't treat that exit code as a reason to retry or
  report a broken pipeline.
