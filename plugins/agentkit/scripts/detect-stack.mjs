#!/usr/bin/env node
// Zero-dependency stack detector. Node ESM only, no npm install required — this
// runs in Python and Rust repos with nothing extra because Claude Code already
// requires a Node runtime.
//
// Fallback only: agents should prefer a committed .agentkit.yml over this
// script's output. This script has no idea what your CI actually runs; it can
// only report what a plain checkout gives it evidence for. It never emits a
// command key it cannot justify with a concrete file on disk.
//
// Usage: node detect-stack.mjs [root]
// Output: a single JSON object on stdout.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ? process.argv[2] : process.cwd();

function has(...segments) {
  return existsSync(join(root, ...segments));
}

function readText(...segments) {
  try {
    return readFileSync(join(root, ...segments), "utf8");
  } catch {
    return null;
  }
}

function readJson(...segments) {
  const text = readText(...segments);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Cheap substring search across a handful of manifest-shaped text files.
// Not a TOML/YAML parser — just evidence-gathering for "is this dependency
// declared anywhere plausible", which is all detection needs.
function manifestsMention(name, files) {
  for (const file of files) {
    const text = readText(...file);
    if (text && text.includes(name)) return true;
  }
  return false;
}

const result = {};
const warnings = [];

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------
function detectPython() {
  const hasUvLock = has("uv.lock");
  const hasPoetryLock = has("poetry.lock");
  const hasPyproject = has("pyproject.toml");
  const hasRequirements = has("requirements.txt") || has("requirements-dev.txt") || has("requirements") ;
  const hasSetupPy = has("setup.py") || has("setup.cfg");
  const hasPipfile = has("Pipfile") || has("Pipfile.lock");

  if (!hasUvLock && !hasPoetryLock && !hasPyproject && !hasRequirements && !hasSetupPy && !hasPipfile) {
    return null;
  }

  let packageManager;
  let runPrefix;
  if (hasUvLock) {
    packageManager = "uv";
    runPrefix = "uv run";
  } else if (hasPoetryLock) {
    packageManager = "poetry";
    runPrefix = "poetry run";
  } else if (hasPipfile) {
    packageManager = "pipenv";
    runPrefix = "pipenv run";
  } else {
    packageManager = "pip";
    runPrefix = "";
  }

  const manifestFiles = [
    ["pyproject.toml"],
    ["requirements.txt"],
    ["requirements-dev.txt"],
    ["setup.cfg"],
  ];

  const python = { language: "python", root: ".", package_manager: packageManager };

  const hasPytest = manifestsMention("pytest", manifestFiles);
  if (hasPytest) {
    python.test = runPrefix ? `${runPrefix} pytest` : "pytest";
    python.test_one = runPrefix ? `${runPrefix} pytest {test_id}` : "pytest {test_id}";
    if (manifestsMention("pytest-cov", manifestFiles) || manifestsMention("coverage", manifestFiles)) {
      python.coverage = runPrefix
        ? `${runPrefix} pytest --cov --cov-report=term-missing`
        : "pytest --cov --cov-report=term-missing";
    }
  } else {
    warnings.push("Python project detected but no pytest dependency found; omitting backend.test.");
  }

  if (manifestsMention("ruff", manifestFiles)) {
    python.lint = runPrefix ? `${runPrefix} ruff check .` : "ruff check .";
    python.fmt = runPrefix ? `${runPrefix} ruff format --check .` : "ruff format --check .";
  } else if (manifestsMention("black", manifestFiles)) {
    python.fmt = runPrefix ? `${runPrefix} black --check .` : "black --check .";
  }

  if (manifestsMention("mypy", manifestFiles)) {
    python.typecheck = runPrefix ? `${runPrefix} mypy .` : "mypy .";
  }

  return python;
}

// ---------------------------------------------------------------------------
// Node / frontend
// ---------------------------------------------------------------------------
function detectNode() {
  const pkg = readJson("package.json");
  if (!pkg) return null;

  let packageManager = null;
  if (has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (has("yarn.lock")) packageManager = "yarn";
  else if (has("bun.lockb") || has("bun.lock")) packageManager = "bun";
  else if (has("package-lock.json")) packageManager = "npm";
  else {
    // No lockfile committed. package.json existing is still evidence a Node
    // toolchain is in play; npm ships with Node so it's a safe default runner,
    // but flag the guess since the *manager* itself is unverified.
    packageManager = "npm";
    warnings.push("No lockfile found next to package.json; assumed npm as the package manager.");
  }

  const runCmd = (script) => {
    if (packageManager === "npm") return `npm run ${script}`;
    if (packageManager === "yarn") return `yarn ${script}`;
    if (packageManager === "pnpm") return `pnpm ${script}`;
    if (packageManager === "bun") return `bun run ${script}`;
    return `${packageManager} run ${script}`;
  };

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const node = { language: "node", root: ".", package_manager: packageManager };
  let wired = false;

  if (scripts.test) {
    node.test = packageManager === "npm" ? "npm test" : runCmd("test");
    wired = true;
    if (deps.vitest) {
      node.test_one = `${packageManager === "npm" ? "npx" : packageManager === "yarn" ? "yarn" : packageManager} vitest run {test_file}`;
    } else if (deps.jest) {
      node.test_one = `${packageManager === "npm" ? "npx" : packageManager === "yarn" ? "yarn" : packageManager} jest {test_file}`;
    }
  }
  if (scripts.lint) {
    node.lint = runCmd("lint");
    wired = true;
  }
  if (scripts.typecheck) {
    node.typecheck = runCmd("typecheck");
    wired = true;
  } else if (scripts["type-check"]) {
    node.typecheck = runCmd("type-check");
    wired = true;
  }
  if (scripts.fmt) {
    node.fmt = runCmd("fmt");
    wired = true;
  } else if (scripts.format) {
    node.fmt = runCmd("format");
    wired = true;
  }
  if (scripts.coverage) {
    node.coverage = runCmd("coverage");
    wired = true;
  }

  if (!wired) {
    warnings.push("package.json found but no test/lint/typecheck/fmt scripts defined; backend/frontend node commands omitted.");
    return { language: "node", root: ".", package_manager: packageManager, _no_scripts: true };
  }

  // Frontend signal: a UI framework or a browser test tool in the dependency graph.
  const frontendMarkers = ["react", "react-dom", "vue", "svelte", "next", "@angular/core", "vite"];
  const isFrontend = frontendMarkers.some((m) => Object.prototype.hasOwnProperty.call(deps, m));
  if (isFrontend) {
    const frontend = { ...node };
    delete frontend._no_scripts;
    if (scripts["test:e2e"]) {
      frontend.e2e = runCmd("test:e2e");
    } else if (scripts.e2e) {
      frontend.e2e = runCmd("e2e");
    } else if (deps["@playwright/test"]) {
      warnings.push("Playwright dependency found but no test:e2e/e2e script defined; omitting frontend.e2e.");
    }
    return { backend: null, frontend };
  }

  return { backend: node, frontend: null };
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------
function detectRust() {
  if (!has("Cargo.toml")) return null;
  const rust = { language: "rust", root: ".", package_manager: "cargo" };

  // `cargo test` and `cargo fmt --check` ship with the standard toolchain, so
  // Cargo.toml's presence alone is enough evidence to emit them.
  if (has(".config", "nextest.toml") || manifestsMention("nextest", [["Cargo.toml"]])) {
    rust.test = "cargo nextest run";
    rust.test_one = "cargo nextest run {test_name}";
  } else {
    rust.test = "cargo test";
    rust.test_one = "cargo test {test_name}";
  }
  rust.fmt = "cargo fmt --check";
  rust.lint = "cargo clippy --all-targets -- -D warnings";
  return rust;
}

// ---------------------------------------------------------------------------
// Task runner
// ---------------------------------------------------------------------------
function detectTaskRunner() {
  if (has("Makefile")) return "make";
  if (has("Justfile") || has("justfile")) return "just";
  if (has("Taskfile.yml") || has("Taskfile.yaml")) return "task";
  if (has("package.json")) return "npm scripts";
  return null;
}

// ---------------------------------------------------------------------------
// CI config (presence only — extracting commands from it is skills/init's job)
// ---------------------------------------------------------------------------
function detectCi() {
  const files = [];
  let provider = null;

  if (has(".github", "workflows")) {
    try {
      for (const entry of readdirSync(join(root, ".github", "workflows"))) {
        if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
          files.push(`.github/workflows/${entry}`);
        }
      }
      if (files.length > 0) provider = "github-actions";
    } catch {
      // unreadable directory; treat as no CI evidence
    }
  }
  if (has(".gitlab-ci.yml")) {
    files.push(".gitlab-ci.yml");
    provider = provider ? `${provider}+gitlab-ci` : "gitlab-ci";
  }
  if (has(".circleci", "config.yml")) {
    files.push(".circleci/config.yml");
    provider = provider ? `${provider}+circleci` : "circleci";
  }

  if (files.length === 0) return null;
  return { provider, files };
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------
const python = detectPython();
const nodeResult = detectNode();
const rust = detectRust();

if (python) result.backend = python;
if (rust) {
  if (result.backend) {
    warnings.push("Both Python and Rust manifests detected; keeping Python as backend and reporting Rust separately.");
    result.backend_rust = rust;
  } else {
    result.backend = rust;
  }
}
if (nodeResult) {
  if (nodeResult.frontend) {
    result.frontend = nodeResult.frontend;
    if (!result.backend && nodeResult.backend) result.backend = nodeResult.backend;
  } else if (nodeResult.backend) {
    if (result.backend) {
      warnings.push("Both a non-Node backend and a Node package.json were detected; reporting Node separately as frontend_node.");
      result.frontend_node = nodeResult.backend;
    } else {
      result.backend = nodeResult.backend;
    }
  } else if (nodeResult._no_scripts !== undefined) {
    result.frontend_node = nodeResult;
  }
}

const taskRunner = detectTaskRunner();
if (taskRunner) result.task_runner = taskRunner;

const ci = detectCi();
if (ci) result.ci = ci;

result.warnings = warnings;
result.warning =
  "This is heuristic fallback output, not verified. Prefer commands read from CI " +
  "config or a committed .agentkit.yml over anything inferred here. Do not run an " +
  "emitted command without first checking it against how CI actually invokes it.";

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
