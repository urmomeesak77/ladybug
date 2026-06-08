# Feature Specification: Project Infrastructure Scaffold

**Feature Branch**: `001-infra-scaffold`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "Install project infrastructure: scaffold backend and frontend skeletons with lint/test tooling and a dev docker-compose"

## Clarifications

### Session 2026-06-08

- Q: Is the `frontend/` app written in TypeScript or JavaScript? → A: TypeScript (`.ts`/`.tsx`, with `typescript` and a TS-aware ESLint config).
- Q: Should this feature demonstrate the SPA calling the backend API, or keep the two skeletons independent? → A: Independent — no CORS/dev-proxy config or SPA→API call now; cross-stack wiring is deferred to the first data-fetching feature.

## User Scenarios & Testing *(mandatory)*

> The "users" of this feature are the project's developers and contributors (and the
> automated CI pipeline acting on their behalf). The value delivered is a working,
> reproducible foundation that every later feature builds on.

### User Story 1 - CI pipeline turns green (Priority: P1)

The existing CI pipeline (currently red by design) runs lint and test jobs for a
`backend/` Laravel app and a `frontend/` React app. A contributor pushes the scaffolded
skeletons and both CI jobs pass, including the ≥90% coverage gate.

**Why this priority**: This is the single observable signal that the foundation exists and
is correct. Until CI is green, no later feature has a trustworthy base to build on. It is
also the smallest end-to-end slice that exercises every piece (structure, lint config, test
runner, coverage gate) at once.

**Independent Test**: Push the branch and observe that the `Backend (Laravel)` and
`Frontend (React)` CI jobs both complete successfully, with the coverage gate reporting
≥90%. Fully verifiable from the CI run alone, with no other features present.

**Acceptance Scenarios**:

1. **Given** the scaffolded `backend/`, **When** the backend CI job runs lint then tests
   with coverage, **Then** Pint reports no style violations and PHPUnit passes with line
   coverage ≥90%.
2. **Given** the scaffolded `frontend/`, **When** the frontend CI job runs lint then tests
   with coverage, **Then** ESLint reports no errors and Vitest passes with line coverage ≥90%.
3. **Given** both jobs pass, **When** the overall workflow completes, **Then** the CI status
   for the branch is green.

---

### User Story 2 - New contributor runs the backend locally in one command (Priority: P2)

A developer who has just cloned the repository on a fresh machine (Windows included) can
bring up the local development environment — PHP/web server, MySQL, and the Node toolchain —
with a single documented command, without manually installing language runtimes or a database.

**Why this priority**: Reproducible, low-friction local setup is the next most valuable thing
after a green CI: it removes "works on my machine" drift and makes the matching CI versions
the same versions developers use. It depends on the skeletons from P1 existing but adds the
convenience layer on top.

**Independent Test**: On a machine with only the container runtime installed, run the
documented startup command and confirm the backend responds on its local URL and can reach
the database, and the frontend dev server serves the app.

**Acceptance Scenarios**:

1. **Given** only the container runtime is installed, **When** the developer runs the
   documented "start" command, **Then** the backend service, a MySQL service, and the Node
   toolchain start and become reachable locally.
2. **Given** the environment is running, **When** the developer requests the backend's health
   or root endpoint, **Then** it responds successfully and can connect to the database.
3. **Given** the local environment definition, **When** its runtime versions are compared to
   CI, **Then** the PHP, MySQL, and Node major versions match the CI configuration.

---

### User Story 3 - Contributor copies env template and configures secrets safely (Priority: P3)

A developer can derive a working configuration from a committed example file without any real
secret ever being committed to the repository.

**Why this priority**: Required by the constitution (secrets in env only; `.env` never
committed; provide `.env.example`), but it is a thin slice that rides on the skeletons rather
than being independently demonstrable to an end user.

**Independent Test**: Confirm a committed example env file exists with placeholder values,
that the real env file is git-ignored, and that copying the example yields a config the app
can boot from.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** the developer copies the example env file to the real
   env file and generates the app key, **Then** the backend boots without missing-config
   errors.
2. **Given** the repository, **When** its ignore rules are inspected, **Then** real env files
   and other secret-bearing files are excluded from version control.

---

### Edge Cases

- **Coverage exactly at the boundary**: A stack whose line coverage is exactly 90% passes;
  89.x% fails. The seed test(s) must keep each stack at or above the threshold.
- **Empty or malformed coverage report**: If a coverage report is missing or unparseable, the
  coverage gate treats it as a failure rather than silently passing.
- **Fresh machine, no language runtimes**: Local startup must not assume PHP, MySQL, or Node
  are pre-installed on the host beyond the container runtime.
- **Version drift between local env and CI**: If local runtime versions diverge from CI, that
  is a defect to be reconciled, not tolerated.
- **Lint config present but no source to lint**: Lint must succeed (no errors) on the minimal
  scaffold, not error out for lack of files.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST contain a `backend/` application skeleton and a separate
  `frontend/` application skeleton, each with its own dependency manifest and lockfile, matching
  the two-app layout the CI pipeline already expects.
- **FR-002**: The backend skeleton MUST include style/lint configuration and a test suite such
  that the backend CI job's lint step reports no violations and its test step passes.
- **FR-003**: The frontend skeleton MUST be written in **TypeScript** (`.ts`/`.tsx`) and include
  TypeScript tooling plus a TS-aware lint configuration and a test suite, such that the frontend
  CI job's lint step reports no errors and its test step passes.
- **FR-004**: Each stack MUST ship at least one meaningful passing test and MUST report line
  coverage of **90% or higher**, satisfying the existing coverage gate (Constitution
  Principle VII).
- **FR-005**: Tests MUST live under each stack's top-level `tests/` directory, mirroring source
  paths, per Constitution Principle VII.
- **FR-006**: The backend skeleton MUST provide a committed example environment file with
  placeholder values, and the real environment file(s) MUST be excluded from version control.
- **FR-007**: The project MUST provide a local development environment definition that starts
  the backend, a MySQL database, and the Node toolchain with a single documented command.
- **FR-008**: The local development environment's PHP, MySQL, and Node major versions MUST match
  the versions used by the CI pipeline.
- **FR-009**: The local development environment MUST be scoped to development convenience only;
  it MUST NOT become a second source of truth that the CI pipeline depends on, and a
  production deployment image is explicitly OUT of scope for this feature.
- **FR-010**: Scaffolding MUST NOT introduce runtime npm or Composer dependencies beyond the
  baseline lint/test toolchain the CI pipeline already invokes; any addition beyond that
  baseline requires explicit approval per Constitution Principle I.
- **FR-011**: A short setup/README note MUST document how to start the local environment, copy
  the env template, and run lint and tests for each stack.

### Key Entities *(include if feature involves data)*

- **Backend skeleton**: The Laravel application root under `backend/` — its dependency
  manifest/lockfile, lint config, env example, and a `tests/` tree with at least one passing,
  covered test.
- **Frontend skeleton**: The React + Vite + **TypeScript** application root under `frontend/` —
  its dependency manifest/lockfile, TS config, TS-aware lint config, and a `tests/` tree with at
  least one passing, covered test.
- **Local environment definition**: The container/compose configuration plus its supporting
  files that describe the backend, database, and Node toolchain services for local development.
- **Environment template**: The committed example env file (placeholders only) from which a
  real, git-ignored configuration is derived.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both CI jobs (backend and frontend) pass on the branch, and the overall CI status
  is green.
- **SC-002**: Reported line coverage is **≥90%** for each stack, as enforced by the coverage
  gate.
- **SC-003**: A developer on a fresh machine (with only the container runtime installed) can go
  from clone to a running backend reachable locally and connected to the database in under 15
  minutes, following only the documented setup steps.
- **SC-004**: A single documented command starts the full local development environment.
- **SC-005**: No real secret or real environment file is present in version control; an example
  env file with placeholders is present.
- **SC-006**: The number of runtime dependencies added beyond the CI lint/test baseline is zero
  (any exception is explicitly approved and recorded).

## Assumptions

- The intended target layout is the decoupled two-app structure (`backend/` + `frontend/`) that
  the existing `ci.yml` and `CLAUDE.md` already describe, not the prototype's
  React-inside-Laravel arrangement.
- CI version targets are treated as authoritative for local parity: PHP 8.3, MySQL 8.0, and
  Node 20 (as configured in `.github/workflows/ci.yml`).
- The container runtime used for local development is Docker / Docker Compose, since that is the
  common cross-platform option and the developer works on Windows; no production image or
  deployment target is selected as part of this feature.
- "One passing test per stack" means a genuine, meaningful test (not a trivial always-true
  assertion) sufficient to legitimately reach the 90% coverage threshold on the minimal scaffold.
- No application features (auth, feed, uploads, meme pages) are implemented here; this feature
  delivers only the foundation those features will be built on.
- The two skeletons are validated independently: the backend's health endpoint is exercised by a
  backend test, and the SPA does not call the API in this feature. Cross-stack wiring (CORS, a
  Vite dev proxy, and any SPA→API integration test) is OUT of scope and deferred to the first
  data-fetching feature.
- The existing CI workflow and coverage-gate script are correct and remain unchanged by this
  feature except where scaffolding is required to satisfy them.
