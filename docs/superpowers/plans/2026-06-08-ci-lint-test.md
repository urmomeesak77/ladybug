# CI Pipeline (Lint + Test) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI pipeline that lints and tests the Laravel `backend/` and React `frontend/`, enforcing the constitution's ≥90% coverage gate.

**Architecture:** One workflow file (`.github/workflows/ci.yml`) with two parallel jobs (`backend`, `frontend`) on push-to-`master` and pull requests. The backend coverage gate is a small standalone Python script (`.github/scripts/check_coverage.py`) so it is unit-testable locally and runs on the runner's preinstalled `python3`. The frontend uses Vitest's native coverage threshold.

**Tech Stack:** GitHub Actions, `shivammathur/setup-php` (PHP 8.3 + pcov), MySQL 8 service, Laravel Pint + PHPUnit, `actions/setup-node` (Node 20), ESLint, Vitest. Gate script in Python 3 (stdlib only).

**Scope note:** Workflow-only. No app code is scaffolded here, so the pipeline is expected to be red until `backend/` and `frontend/` exist. See `docs/superpowers/specs/2026-06-08-ci-lint-test-design.md`.

**Local tooling available:** Python 3.14, Node 24. (No PHP/actionlint/yamllint locally — verification commands below account for this.)

---

## File Structure

- Create: `.github/scripts/check_coverage.py` — parses a Clover report and fails below a threshold. Stdlib only.
- Create: `.github/scripts/tests/test_check_coverage.py` — unittest suite for the gate script (CI tooling test, not app code).
- Create: `.github/workflows/ci.yml` — the two-job CI workflow.

---

### Task 1: Backend coverage-gate script (TDD)

**Files:**
- Create: `.github/scripts/check_coverage.py`
- Test: `.github/scripts/tests/test_check_coverage.py`

- [ ] **Step 1: Write the failing test**

Create `.github/scripts/tests/test_check_coverage.py`:

```python
"""Unit tests for the Clover coverage gate (CI tooling, not application code)."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check_coverage.py"

CLOVER_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<coverage generated="1">
  <project timestamp="1">
    <metrics files="1" loc="10" statements="{statements}" \
coveredstatements="{covered}" methods="1" coveredmethods="1"/>
  </project>
</coverage>
"""


def run_gate(statements, covered, threshold):
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as handle:
        handle.write(CLOVER_TEMPLATE.format(statements=statements, covered=covered))
        path = handle.name
    try:
        return subprocess.run(
            [sys.executable, str(SCRIPT), path, str(threshold)],
            capture_output=True,
            text=True,
        )
    finally:
        os.unlink(path)


class CoverageGateTest(unittest.TestCase):
    def test_passes_above_threshold(self):
        result = run_gate(100, 95, 90)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fails_below_threshold(self):
        result = run_gate(100, 80, 90)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_exactly_at_threshold_passes(self):
        result = run_gate(100, 90, 90)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_zero_statements_passes(self):
        result = run_gate(0, 0, 90)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python .github/scripts/tests/test_check_coverage.py`
Expected: FAIL — the subprocess can't find `check_coverage.py`, so return codes are non-zero (e.g. `2`) and assertions fail.

- [ ] **Step 3: Write the minimal implementation**

Create `.github/scripts/check_coverage.py`:

```python
#!/usr/bin/env python3
"""Fail CI when Clover line/statement coverage falls below a threshold.

Usage: python check_coverage.py <clover.xml> <min_percent>

Reads the project-level <metrics> aggregate emitted by PHPUnit/Clover and
compares coveredstatements/statements against the minimum. Stdlib only so it
runs on the runner's preinstalled python3 with no extra dependency.
"""
import sys
import xml.etree.ElementTree as ET


def coverage_percent(clover_path):
    metrics = ET.parse(clover_path).getroot().find("project/metrics")
    if metrics is None:
        raise ValueError("no <project><metrics> element in clover report")
    statements = int(metrics.get("statements", 0))
    covered = int(metrics.get("coveredstatements", 0))
    if statements == 0:
        return 100.0
    return covered / statements * 100


def main(argv):
    if len(argv) != 3:
        print("usage: check_coverage.py <clover.xml> <min_percent>", file=sys.stderr)
        return 2
    clover_path = argv[1]
    min_percent = float(argv[2])
    percent = coverage_percent(clover_path)
    print(f"coverage: {percent:.2f}% (min {min_percent:.2f}%)")
    if percent < min_percent:
        print("coverage gate FAILED", file=sys.stderr)
        return 1
    print("coverage gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python .github/scripts/tests/test_check_coverage.py`
Expected: PASS — `Ran 4 tests ... OK`.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/check_coverage.py .github/scripts/tests/test_check_coverage.py
git commit -m "ci: add Clover coverage gate script with tests"
```

---

### Task 2: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  backend:
    name: Backend (Laravel)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_DATABASE: ladybug_test
          MYSQL_ROOT_PASSWORD: root
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -proot"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
    env:
      DB_CONNECTION: mysql
      DB_HOST: 127.0.0.1
      DB_PORT: 3306
      DB_DATABASE: ladybug_test
      DB_USERNAME: root
      DB_PASSWORD: root
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: pcov
          tools: composer

      - name: Cache Composer packages
        uses: actions/cache@v4
        with:
          path: backend/vendor
          key: composer-${{ hashFiles('backend/composer.lock') }}
          restore-keys: composer-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Prepare environment
        run: |
          cp .env.example .env
          php artisan key:generate

      - name: Lint (Pint)
        run: vendor/bin/pint --test

      - name: Test with coverage
        run: php artisan test --coverage-clover=coverage.clover

      - name: Coverage gate (>=90%)
        run: python3 ../.github/scripts/check_coverage.py coverage.clover 90

  frontend:
    name: Frontend (React)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint (ESLint)
        run: npm run lint

      - name: Test with coverage (>=90%)
        run: npx vitest run --coverage --coverage.thresholds.lines=90
```

- [ ] **Step 2: Validate the YAML is well-formed**

Run (installs PyYAML quietly first since it is not in the stdlib):

```bash
python -m pip install --quiet pyyaml && \
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`. (Note: YAML 1.1 parses the `on:` key as boolean `True`; that is harmless here — this check only confirms well-formedness, and GitHub interprets the file correctly.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint+test workflow for backend and frontend"
```

---

### Task 3: Confirm the pipeline registers (expected-red verification)

**Files:** none (verification only).

- [ ] **Step 1: Push and confirm the workflow is picked up**

```bash
git push origin master
```

- [ ] **Step 2: Observe the run**

Run: `gh run list --workflow=ci.yml --limit 1` (or open the Actions tab).
Expected: a run appears for `CI`. Both jobs **fail early** — `backend` at "Install dependencies" (no `backend/composer.json`) and `frontend` at "Install dependencies" (no `frontend/package-lock.json`). This is the intended workflow-only outcome: the pipeline is wired and will go green once the apps are scaffolded with their lint/test tooling and passing tests.

- [ ] **Step 3: Record the follow-up**

No commit. The design doc already lists the follow-ups (branch-protection required checks, CD job, scaffold the apps). Stop here.

---

## Notes for the implementer

- **Working directories:** `actions/cache` `path:` and `setup-node` `cache-dependency-path:` are resolved from the **repo root**, which is why they use `backend/…` / `frontend/…` even though the `run` steps default into those subdirs. The coverage gate runs with cwd `backend/`, so it calls the script via `../.github/scripts/check_coverage.py` and reads `coverage.clover` from the cwd.
- **No new app dependencies:** the workflow only invokes Pint, PHPUnit, ESLint, and Vitest, which the standard scaffolds ship. Do not add runtime dependencies here (Constitution Principle I).
- **Frontend threshold assumption:** `npx vitest run --coverage` requires `@vitest/coverage-v8` (or equivalent) to be present in the scaffolded `frontend/`. The `--coverage.thresholds.lines=90` flag makes Vitest fail the job itself when coverage drops below 90%.
```
