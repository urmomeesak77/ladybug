# Contract: Frontend Modules (lib / hook / guards / pages)

Mirrors the 005/006 split: pure, coverage-gated logic in `src/lib`; thin glue elsewhere.

## `src/lib/authApi.ts` (pure-ish; unit-tested, coverage-scoped)

Types:
```ts
export type AuthUser = { id: number; name: string; email: string;
  createdAt: string; updatedAt: string };

export type FieldErrors = Record<string, string[]>;

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }       // 401 generic (login)
  | { ok: false; kind: 'network' };   // fetch rejected / non-handled status
```

Functions (all use `credentials: 'include'`, `Accept: application/json`; unsafe methods
send `X-XSRF-TOKEN`):
- `csrf(): Promise<void>` — `GET /sanctum/csrf-cookie`.
- `register(input): Promise<AuthResult>` — `POST /api/register`; maps 201→ok,
  422→validation, else→network.
- `login(input): Promise<AuthResult>` — `POST /api/login`; 200→ok, 401→auth,
  422→validation, else→network.
- `logout(): Promise<{ ok: boolean }>` — `POST /api/logout`.
- `fetchCurrentUser(): Promise<AuthUser | null>` — `GET /api/user`; returns the user, or
  `null` for anonymous (`data:null` **or** 401) and on network failure.

A small `mapUser(raw)` adapts the API's snake_case payload to `AuthUser` (like
`feedModel.mapPost`). Unit tests mock `fetch` and assert status mapping + that
`credentials:'include'` and the CSRF header are sent.

## `src/lib/authModel.ts` (pure; unit-tested, coverage-scoped)

- `AuthStatus = 'unknown' | 'anonymous' | 'authenticated'`.
- `validateRegister(values): FieldErrors` and `validateLogin(values): FieldErrors` —
  client mirror of server rules (required, email shape, password length/variety,
  confirmation match); empty object means valid.
- `mergeServerErrors(client, server): FieldErrors` — server messages win.
- Pure reducers/helpers for the form submission state machine (data-model.md).

## `src/hooks/useAuth.ts` (thin glue; not coverage-scoped)

- Context provider holding `{ status, user }`; on mount calls `fetchCurrentUser` and sets
  `authenticated`/`anonymous`.
- Exposes `login`, `register`, `logout` (delegating to `authApi`, updating state) and the
  current `user`.
- A `401` observed by any caller flips state to `anonymous`.

## `src/components/RequireAuth.tsx` / `RequireAnon.tsx` (thin glue)

- `RequireAuth`: `unknown`→placeholder; `anonymous`→`<Navigate to="/login">`;
  `authenticated`→children.
- `RequireAnon`: `unknown`→placeholder; `authenticated`→`<Navigate to="/">`;
  `anonymous`→children.

## `src/components/NavMenu.tsx` (edit; thin glue)

- Anonymous: existing Login/Register affordance.
- Authenticated: Account link + Logout control. Reflects `status` (treat `unknown` as
  not-yet-authenticated for rendering, no flicker of authed-only items).

## Pages (thin glue; manual-verification gate)

- `LoginPage.tsx`: email + password; client validate → `login`; show field errors,
  the generic auth banner on 401, retryable banner on network error; disable while
  submitting; never repopulate password.
- `RegisterPage.tsx`: name + email + password + confirm; client validate → `register`;
  inline field errors (incl. server 422 like duplicate email); same submit guards.
- `AccountPage.tsx`: shows `user.name` + `user.email` and a Logout button → `logout` then
  redirect home/anon.

## `src/App.tsx` (edit)

Wrap routes in the `AuthProvider`; add `/login`, `/register` (under `RequireAnon`) and
`/account` (under `RequireAuth`). Existing `/`, `/posts/:hash`, and `*` routes unchanged.
