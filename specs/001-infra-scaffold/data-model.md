# Phase 1 Data Model: Project Infrastructure Scaffold

This feature provisions infrastructure, not domain data. **No database schema, migrations, or
Eloquent models are authored here** beyond the framework-default `User` (which is left untouched
and only lightly covered by a test). Domain entities (Meme, etc.) arrive with their own features.

The "entities" below are therefore the configuration/code artifacts the scaffold introduces and
the one small value-object it seeds.

## Value object: `PublicCode` (seed unit)

The single piece of real domain logic introduced now, pre-building Constitution Principle V.

| Aspect | Definition |
|--------|------------|
| Purpose | Generate and validate the stable, opaque public identifier for memes. |
| Format | Exactly **11 characters**, each drawn from `[A-Z0-9-]` (uppercase A–Z, digits 0–9, hyphen). |
| `generate()` | Returns a fresh random 11-char code conforming to the format. |
| `isValid(value)` | `true` iff `value` is a string of length 11 matching `^[A-Z0-9-]{11}$`. |
| Immutability | Codes are values; once assigned to a meme (future feature) they never change. |
| Implementations | Backend: `app/Support/PublicCode.php` (PHP). Frontend: `src/lib/publicCode.ts` (pure TypeScript mirror, validation-side). |

**Validation rules (tested as edge cases)**:
- Length ≠ 11 → invalid.
- Contains lowercase or any char outside `[A-Z0-9-]` → invalid.
- Empty / non-string → invalid.
- `generate()` output always satisfies `isValid()`.

## Configuration artifacts (no persistent data)

| Artifact | Represents | Key fields / contents |
|----------|------------|-----------------------|
| `backend/composer.json` (+lock) | Backend dependency manifest | baseline runtime + Pint/PHPUnit/Collision/Faker dev tools |
| `backend/phpunit.xml` | Test + coverage config | testsuites Unit/Feature; `<source><include>app</source>` |
| `backend/pint.json` | PHP lint ruleset | PSR-12-aligned preset |
| `backend/.env.example` | Env template (placeholders) | `APP_KEY=` (blank), `DB_*` pointing at dev/CI MySQL |
| `frontend/package.json` (+lock) | Frontend dependency manifest | React/Vite runtime + TypeScript/ESLint/Vitest/coverage-v8 dev tools; `lint` + `test` scripts |
| `frontend/tsconfig.json` | TypeScript compiler config | `strict: true`, modern ESM target |
| `frontend/vite.config.ts` | Build + Vitest config | react plugin; coverage provider `v8`, line threshold 90 |
| `frontend/eslint.config.js` | TS/TSX lint ruleset | recommended + `typescript-eslint` + React + project conventions |
| `docker-compose.yml` | Dev environment definition | services `php` (8.3), `mysql` (8.0), `node` (20) |

## Relationships

- The two app skeletons are **independent deployables** sharing no code; they communicate (in
  future features) only over the JSON API. This feature adds just one endpoint contract
  (`GET /api/health`, see `contracts/health.md`).
- `docker-compose.yml` orchestrates both skeletons + MySQL for local dev; it is **not** a CI
  dependency (CI provisions services via GitHub Actions directly).
- The frontend `publicCode.ts` mirrors the backend `PublicCode` validation contract so both
  stacks agree on the Principle V format.
