# Auth UI ↔ Prototype Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ladybug's login/register pages look and behave like the Trashpost prototype (neutral palette site-wide, placeholder-style fields, on-blur validation with a gated submit, NoticeDialog modal, cross-links) per `docs/superpowers/specs/2026-07-06-auth-prototype-alignment-design.md`.

**Architecture:** Frontend-only. `theme.css` swaps the red accent for a neutral `#4a5568` control border + a red reserved for error text. `AuthModel` gains touched-aware validation. `AuthField` becomes sr-only-label + placeholder with an `onBlur` hook. A new `NoticeDialog` (native `<dialog>`) renders from a new `NoticeProvider`/`useNotice` pair mounted above the routes (a page-local dialog would unmount when `RequireAnon` redirects after register flips auth state). Login/Register pages adopt blur validation, gated submit, disabled fieldset in flight, and cross-links.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (jsdom), Playwright e2e. No new dependencies (Constitution Principle I).

## Global Constraints

- NO new npm dependencies — hand-rolled validation, NOT react-hook-form.
- `docs/CODING_CONVENTIONS.md` is binding: 2-space indent, semicolons, functions < 50 lines, braces on single-line bodies, comments explain *why*, logic helpers are classes of static methods.
- No closures in logic code (user preference; React components/hooks and their inline handlers are fine — they're the existing idiom).
- Tests mirror `src/` under `frontend/tests/` (Constitution Principle VII); coverage gate is ≥90% of ALL of `src/` in CI.
- Field label text ALWAYS equals placeholder text: `Display name`, `E-mail`, `Password`, `Re-type password` (login uses the last three minus display name; upload keeps `Title (optional)`).
- Button captions: `Login` (login page), `Register` (register page), static while submitting.
- All commands below run from `C:\projects\ladybug\frontend` unless stated otherwise. Node/npm run locally (no Docker needed for unit tests/lint).
- Commit after every task (current branch `master` — no new branches).

---

### Task 1: Neutral theme — tokens, buttons, auth layout, notice dialog CSS

**Files:**
- Modify: `frontend/src/styles/theme.css`

CSS has no unit tests; the gate is `npm run lint` + `npm run build` passing and the later visual check (Task 9). Component classnames used here (`.sr-only`, `.notice-dialog*`, `.auth-form__link`) are consumed by Tasks 4–7.

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-error`, `--color-control-border`; utility class `.sr-only`; classes `.notice-dialog`, `.notice-dialog__buttons`, `.auth-form__link` used by later tasks.

- [ ] **Step 1: Replace the accent tokens with error + control-border tokens**

In the `:root` block (~line 4), replace:

```css
  --color-accent: #c8102e;
  --color-accent-text: #ffffff;
```

with:

```css
  --color-error: #c8102e;
  /* The prototype uses this gray-blue for input/button borders in BOTH schemes. */
  --color-control-border: #4a5568;
```

In the `@media (prefers-color-scheme: dark)` `:root` block (~line 70), replace:

```css
    --color-accent: #ff6b81;
    --color-accent-text: #1b1b1f;
```

with:

```css
    --color-error: #ff6b81;
```

- [ ] **Step 2: Restyle the feed error border and "Load more" (prototype gray block)**

Replace:

```css
.feed-state--error {
  color: var(--color-text);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
}
```

with:

```css
.feed-state--error {
  color: var(--color-text);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
}
```

In `.feed__load-more`, replace the two color lines and the radius:

```css
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  border: 0;
  border-radius: var(--radius-md);
```

with (prototype `.trash-post-list-loadmore`: flat gray block, white text, square):

```css
  background-color: var(--color-control-border);
  color: #ffffff;
  border: 0;
```

- [ ] **Step 3: Replace the auth form styles with the prototype layout**

Replace the whole block from `.auth h1 {` through the end of `.auth-form button[type='submit']:disabled { ... }` (currently ~lines 288–356) with:

```css
/* Auth forms follow the prototype: a centered 600px column, heading with a full-width
   hairline, placeholder-styled fields (labels are sr-only), full-width outlined controls. */
.auth {
  max-width: 600px;
  margin: 0 auto;
  padding: 0 5px;
}

.auth h1 {
  font-size: 1.17rem; /* Prototype renders the heading as an <h3>; keep <h1> semantics. */
  border-bottom: 1px solid var(--color-control-border);
  padding: 10px 0;
  margin-bottom: var(--space-lg);
}

.auth-form fieldset {
  border: 0;
  margin: 0;
  padding: 0;
}

.auth-field {
  display: flex;
  flex-direction: column;
}

.auth-field input {
  width: 100%;
  min-height: 2.75rem; /* ~44px: comfortable touch target on small screens. */
  padding: 8px;
  margin: 0 0 20px 0; /* Prototype rhythm: 20px below every control. */
  font: inherit;
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-control-border);
  border-radius: 4px;
}

/* Invalid fields are flagged by the error text below them — a text signal, never color
   alone (Principle IV / FR-015); aria-invalid stays on the input for assistive tech. */
.auth-field__error {
  color: var(--color-error);
  font-size: 0.875rem;
  margin: -10px 0 20px 0;
  padding-left: 10px;
  white-space: pre-wrap; /* Multiple password-policy violations stack as lines. */
}

/* Form-level banner (failed login, server 422 without a field). Text + bordered box. */
.auth-form__error {
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-md);
  color: var(--color-text);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
}

/* Prototype buttons: full-width, outlined, neutral — no filled accent. */
.auth-form button[type='submit'],
.account__logout {
  width: 100%;
  min-height: 2.75rem;
  padding: 8px;
  font: inherit;
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-control-border);
  border-radius: 10px;
  cursor: pointer;
}

.auth-form button[type='submit']:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Centered cross-links under the form (prototype: "No account? Register here...."). */
.auth-form__link {
  text-align: center;
  margin-bottom: var(--space-sm);
}

.auth-form__link a {
  color: var(--color-text);
}
```

(Note: the old `.auth-form { display:flex; gap; max-width: 24rem }`, the `.auth-field input[aria-invalid='true']` accent-border rule, and the `gap`-based spacing are gone on purpose — the 20px margins reproduce the prototype rhythm, and `.account__logout` keeps working via the shared button rule. `cursor: not-allowed` replaces `progress` because the button is now also disabled while validation errors exist, not only in flight.)

- [ ] **Step 4: Add the sr-only utility and notice-dialog styles (end of file)**

```css
/* Visually hidden but available to assistive tech: auth fields look placeholder-only
   (prototype) while every input keeps a real <label> (Principle IV). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Native <dialog> notice modal, ported from the prototype. */
.notice-dialog {
  min-width: 300px;
  max-width: 600px;
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-control-border);
  border-radius: 4px;
  padding: 10px;
}

.notice-dialog::backdrop {
  background: rgb(0 0 0 / 50%);
}

.notice-dialog h2 {
  margin: 5px 0;
  font-size: 1rem;
  font-weight: bold;
}

.notice-dialog p {
  white-space: pre-wrap;
}

.notice-dialog__buttons {
  margin: 20px 0 10px 0;
  text-align: right;
}

.notice-dialog__buttons button {
  min-width: 50px;
  padding: 8px;
  font: inherit;
  color: var(--color-text);
  background-color: var(--color-surface);
  border: 1px solid var(--color-control-border);
  border-radius: 10px;
  cursor: pointer;
}
```

- [ ] **Step 5: Verify nothing else references the removed tokens, then lint/build**

Run: `Select-String -Path src -Pattern 'color-accent' -SimpleMatch -Recurse` → expect NO matches (PowerShell), or use ripgrep equivalent.
Run: `npm run lint` → Expected: exit 0.
Run: `npm run build` → Expected: exit 0 (tsc + vite build succeed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/theme.css
git commit -m "style(theme): adopt the prototype's neutral palette site-wide"
```

---

### Task 2: Touched-aware validation in AuthModel

**Files:**
- Modify: `frontend/src/lib/authModel.ts`
- Test: `frontend/tests/lib/authModel.test.ts`

**Interfaces:**
- Consumes: existing types `RegisterValues`, `LoginValues`, `FieldErrors`.
- Produces (used by Tasks 6–7):
  - `AuthModel.validateRegister(values: RegisterValues, touched?: Set<string>): FieldErrors`
  - `AuthModel.validateLogin(values: LoginValues, touched?: Set<string>): FieldErrors`
  - Omitted `touched` = validate every field (submit-time behavior).
  - Register field keys: `name`, `email`, `password`, `passwordConfirmation`. Login: `email`, `password`.
  - Message texts (exact):
    - `Display name is required.` / `E-mail is required.` / `Password is required.` / `Re-type password is required.`
    - `Enter a valid email address.`
    - Password policy, one entry per violation (prototype/Laravel wording):
      `The password field must be at least 8 characters.`,
      `The password field must contain at least one uppercase and one lowercase letter.`,
      `The password field must contain at least one number.`
    - `Passwords do not match.` (only when password AND confirmation are both touched and both non-empty — prototype behavior).

- [ ] **Step 1: Update/extend the failing tests**

In `frontend/tests/lib/authModel.test.ts`, update the message-dependent tests and add touched-awareness tests. Replace the `validateRegister` and `validateLogin` describes with:

```ts
describe('validateRegister', () => {
  it('returns no errors for valid input', () => {
    expect(AuthModel.validateRegister(validRegister)).toEqual({});
  });

  it('flags a missing name', () => {
    expect(AuthModel.validateRegister({ ...validRegister, name: '  ' }).name)
      .toEqual(['Display name is required.']);
  });

  it('flags a malformed email', () => {
    expect(AuthModel.validateRegister({ ...validRegister, email: 'not-an-email' }).email)
      .toEqual(['Enter a valid email address.']);
  });

  it('reports each password policy violation as its own message', () => {
    const errors = AuthModel.validateRegister({
      ...validRegister, password: 'short', passwordConfirmation: 'short',
    });
    expect(errors.password).toEqual([
      'The password field must be at least 8 characters.',
      'The password field must contain at least one uppercase and one lowercase letter.',
      'The password field must contain at least one number.',
    ]);
  });

  it('flags a confirmation that does not match', () => {
    const errors = AuthModel.validateRegister({ ...validRegister, passwordConfirmation: 'Different1' });
    expect(errors.passwordConfirmation).toEqual(['Passwords do not match.']);
  });

  it('flags an empty confirmation as required', () => {
    const errors = AuthModel.validateRegister({ ...validRegister, passwordConfirmation: '' });
    expect(errors.passwordConfirmation).toEqual(['Re-type password is required.']);
  });

  it('only validates touched fields when a touched set is given', () => {
    const empty = { name: '', email: '', password: '', passwordConfirmation: '' };
    const errors = AuthModel.validateRegister(empty, new Set(['email']));
    expect(errors).toEqual({ email: ['E-mail is required.'] });
  });

  it('holds the mismatch check until both password fields are touched', () => {
    const values = { ...validRegister, passwordConfirmation: 'Different1' };
    const oneTouched = AuthModel.validateRegister(values, new Set(['passwordConfirmation']));
    expect(oneTouched.passwordConfirmation).toBeUndefined();
    const bothTouched = AuthModel.validateRegister(
      values, new Set(['password', 'passwordConfirmation']),
    );
    expect(bothTouched.passwordConfirmation).toEqual(['Passwords do not match.']);
  });
});

describe('validateLogin', () => {
  it('returns no errors for valid input', () => {
    expect(AuthModel.validateLogin({ email: 'ada@example.com', password: 'whatever' })).toEqual({});
  });

  it('flags a missing email and password', () => {
    const errors = AuthModel.validateLogin({ email: '', password: '' });
    expect(errors.email).toEqual(['E-mail is required.']);
    expect(errors.password).toEqual(['Password is required.']);
  });

  it('only validates touched fields when a touched set is given', () => {
    const errors = AuthModel.validateLogin({ email: '', password: '' }, new Set(['password']));
    expect(errors).toEqual({ password: ['Password is required.'] });
  });
});
```

(Keep the existing `mergeServerErrors` and `resolveStatus` describes unchanged.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/authModel.test.ts`
Expected: FAIL — old messages (`Name is required.`, single joined password message) and no touched support.

- [ ] **Step 3: Implement**

Replace the class body of `AuthModel` in `frontend/src/lib/authModel.ts` (keep the file header, types, `EMAIL_PATTERN`, `mergeServerErrors`, `resolveStatus` as they are):

```ts
// Client-side auth form validation and small auth-state helpers, converged onto one class.
// The server re-validates everything (FR-002); these only give instant feedback. A
// `touched` set limits blur-time validation to fields the user has visited (prototype
// behavior); omitting it validates everything, which is what submit does.
export class AuthModel {
  static validateRegister(values: RegisterValues, touched?: Set<string>): FieldErrors {
    const errors: FieldErrors = {};
    if (AuthModel.isTouched(touched, 'name') && !values.name.trim()) {
      errors.name = ['Display name is required.'];
    }
    if (AuthModel.isTouched(touched, 'email')) {
      const emailErrors = AuthModel.emailFieldErrors(values.email);
      if (emailErrors.length > 0) {
        errors.email = emailErrors;
      }
    }
    if (AuthModel.isTouched(touched, 'password')) {
      const passwordErrors = AuthModel.passwordPolicyErrors(values.password);
      if (passwordErrors.length > 0) {
        errors.password = passwordErrors;
      }
    }
    const confirmationErrors = AuthModel.confirmationErrors(values, touched);
    if (confirmationErrors.length > 0) {
      errors.passwordConfirmation = confirmationErrors;
    }
    return errors;
  }

  static validateLogin(values: LoginValues, touched?: Set<string>): FieldErrors {
    const errors: FieldErrors = {};
    if (AuthModel.isTouched(touched, 'email')) {
      const emailErrors = AuthModel.emailFieldErrors(values.email);
      if (emailErrors.length > 0) {
        errors.email = emailErrors;
      }
    }
    if (AuthModel.isTouched(touched, 'password') && !values.password) {
      errors.password = ['Password is required.'];
    }
    return errors;
  }

  // Server-reported field errors override the client's optimistic ones; client-only and
  // server-only fields are both retained.
  static mergeServerErrors(client: FieldErrors, server: FieldErrors): FieldErrors {
    return { ...client, ...server };
  }

  static resolveStatus(user: AuthUser | null): AuthStatus {
    return user ? 'authenticated' : 'anonymous';
  }

  private static isTouched(touched: Set<string> | undefined, field: string): boolean {
    return touched === undefined || touched.has(field);
  }

  private static emailFieldErrors(email: string): string[] {
    if (!email.trim()) {
      return ['E-mail is required.'];
    }
    if (!EMAIL_PATTERN.test(email)) {
      return ['Enter a valid email address.'];
    }
    return [];
  }

  // Mirrors the server policy (min 8, mixed case, a number — research D3), one message
  // per violation like the prototype, so users see exactly what is missing.
  private static passwordPolicyErrors(password: string): string[] {
    if (!password) {
      return ['Password is required.'];
    }
    const violations: string[] = [];
    if (password.length < 8) {
      violations.push('The password field must be at least 8 characters.');
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
      violations.push('The password field must contain at least one uppercase and one lowercase letter.');
    }
    if (!/[0-9]/.test(password)) {
      violations.push('The password field must contain at least one number.');
    }
    return violations;
  }

  // The mismatch check waits until BOTH password fields are touched and non-empty
  // (prototype behavior) so filling the confirmation first is not punished early.
  private static confirmationErrors(values: RegisterValues, touched?: Set<string>): string[] {
    if (AuthModel.isTouched(touched, 'passwordConfirmation') && !values.passwordConfirmation) {
      return ['Re-type password is required.'];
    }
    const bothTouched = AuthModel.isTouched(touched, 'password')
      && AuthModel.isTouched(touched, 'passwordConfirmation');
    const bothFilled = values.password.length > 0 && values.passwordConfirmation.length > 0;
    if (bothTouched && bothFilled && values.password !== values.passwordConfirmation) {
      return ['Passwords do not match.'];
    }
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/authModel.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/authModel.ts frontend/tests/lib/authModel.test.ts
git commit -m "feat(auth): touched-aware validation with prototype message texts"
```

---

### Task 3: AuthField — sr-only label, placeholder, onBlur

**Files:**
- Modify: `frontend/src/components/AuthField.tsx`
- Test: `frontend/tests/components/AuthField.test.tsx`

**Interfaces:**
- Consumes: `.sr-only` class (Task 1).
- Produces (used by Tasks 6–7 and existing `UploadPage`): props
  `{ id: string; label: string; type: string; value: string; autoComplete: string; error?: string; onChange: (value: string) => void; onBlur?: () => void }`.
  The label renders sr-only; the placeholder always equals the label text. `onBlur` is optional so `UploadPage` (which doesn't blur-validate) compiles unchanged.

- [ ] **Step 1: Extend the tests**

Add to `frontend/tests/components/AuthField.test.tsx` inside the `describe` (and update `renderField` to accept `onBlur`):

```tsx
function renderField(error?: string, onChange = vi.fn(), onBlur = vi.fn()) {
  render(
    <AuthField
      id="email"
      label="E-mail"
      type="email"
      value="a@b.co"
      autoComplete="email"
      error={error}
      onChange={onChange}
      onBlur={onBlur}
    />,
  );
  return { onChange, onBlur };
}
```

Update existing tests to destructure (`const { onChange } = renderField();`) and query `getByLabelText('E-mail')`. Then add:

```tsx
  it('hides the label visually and mirrors it as the placeholder', () => {
    renderField();

    const input = screen.getByLabelText('E-mail');
    expect(input.getAttribute('placeholder')).toBe('E-mail');
    expect(document.querySelector('label.sr-only')?.textContent).toBe('E-mail');
  });

  it('reports blur through onBlur', () => {
    const { onBlur } = renderField();

    fireEvent.blur(screen.getByLabelText('E-mail'));

    expect(onBlur).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- tests/components/AuthField.test.tsx`
Expected: FAIL — no placeholder, no sr-only class, no onBlur prop.

- [ ] **Step 3: Implement**

Replace `frontend/src/components/AuthField.tsx` content:

```tsx
// A single auth-form field styled like the prototype: the visible text is the
// placeholder, while a visually-hidden <label> keeps the accessible name (Principle IV).
// The error message is tied to the input via aria-describedby and conveyed as text (not
// by color alone), and aria-invalid marks the field for assistive tech (FR-015).
function AuthField({ id, label, type, value, autoComplete, error, onChange, onBlur }: {
  id: string;
  label: string;
  type: string;
  value: string;
  autoComplete: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="auth-field">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={label}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <span id={errorId} className="auth-field__error" role="alert">{error}</span>
      ) : null}
    </div>
  );
}

export default AuthField;
```

- [ ] **Step 4: Run the component suite plus its consumers**

Run: `npm test -- tests/components/AuthField.test.tsx tests/pages/UploadPage.test.tsx`
Expected: PASS — `UploadPage` uses `getByLabelText`, which still resolves through the sr-only label.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AuthField.tsx frontend/tests/components/AuthField.test.tsx
git commit -m "feat(auth): prototype-style placeholder fields with sr-only labels"
```

---

### Task 4: NoticeDialog component

**Files:**
- Create: `frontend/src/components/NoticeDialog.tsx`
- Test: `frontend/tests/components/NoticeDialog.test.tsx`

**Interfaces:**
- Consumes: `.notice-dialog*` CSS (Task 1).
- Produces (used by Task 5): component `NoticeDialog` with props
  `{ message: string; title?: string; btnCaption?: string; onClose: () => void }` (btnCaption defaults to `'Ok'`).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/NoticeDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeDialog from '../../src/components/NoticeDialog';

afterEach(cleanup);

describe('NoticeDialog', () => {
  it('opens as a modal showing the message and an Ok button', () => {
    render(<NoticeDialog message="Saved." onClose={vi.fn()} />);

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ok' })).toBeTruthy();
  });

  it('renders the optional title and a custom button caption', () => {
    render(<NoticeDialog title="Notice" message="Saved." btnCaption="Fine" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Notice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fine' })).toBeTruthy();
  });

  it('reports the button click through onClose', () => {
    const onClose = vi.fn();
    render(<NoticeDialog message="Saved." onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ok' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports Esc (cancel) through onClose instead of swallowing it', () => {
    const onClose = vi.fn();
    render(<NoticeDialog message="Saved." onClose={onClose} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

If jsdom's `showModal` turns out to be unimplemented (test errors with "showModal is not a function"), add this stub at the top of the test file after the imports — do NOT change the component:

```tsx
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/NoticeDialog.test.tsx`
Expected: FAIL — module `../../src/components/NoticeDialog` not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/NoticeDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react';

// Native <dialog> notice modal, ported from the prototype. Deviation: Esc (the dialog's
// cancel event) reports through onClose instead of being swallowed, so keyboard users can
// always dismiss it (Principle IV).
function NoticeDialog({ message, title, btnCaption = 'Ok', onClose }: {
  message: string;
  title?: string;
  btnCaption?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog className="notice-dialog" ref={dialogRef} onCancel={onClose}>
      {title ? <h2>{title}</h2> : null}
      <p>{message}</p>
      <div className="notice-dialog__buttons">
        <button type="button" onClick={onClose}>{btnCaption}</button>
      </div>
    </dialog>
  );
}

export default NoticeDialog;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/NoticeDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NoticeDialog.tsx frontend/tests/components/NoticeDialog.test.tsx
git commit -m "feat(ui): NoticeDialog modal ported from the prototype"
```

---

### Task 5: useNotice hook + NoticeProvider + App wiring

**Files:**
- Create: `frontend/src/hooks/useNotice.ts`
- Create: `frontend/src/components/NoticeProvider.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/components/NoticeProvider.test.tsx`

**Interfaces:**
- Consumes: `NoticeDialog` (Task 4).
- Produces (used by Tasks 6–7):
  - `type Notice = { message: string; title?: string }`
  - `useNotice(): NoticeContextValue` where `NoticeContextValue = { notice: Notice | null; show: (notice: Notice) => void; clear: () => void }`
  - `NoticeContext` (exported for tests, mirroring `AuthContext`)
  - `<NoticeProvider>` renders children plus the dialog while a notice is set; the dialog's Ok/Esc calls `clear()`.
- Why a provider: a successful register flips auth state and `RequireAnon` unmounts `RegisterPage` immediately — a page-local dialog would vanish. Mounted above the routes it survives the redirect.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/NoticeProvider.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { useNotice } from '../../src/hooks/useNotice';

afterEach(cleanup);

// Minimal consumer: a button that raises a notice, so the provider's render side of the
// contract is observable from the outside.
function Raiser() {
  const { show } = useNotice();
  return (
    <button type="button" onClick={() => show({ message: 'Welcome, Ada!' })}>
      raise
    </button>
  );
}

describe('NoticeProvider', () => {
  it('renders no dialog until a notice is shown', () => {
    render(<NoticeProvider><Raiser /></NoticeProvider>);

    expect(document.querySelector('dialog')).toBeNull();
  });

  it('shows the dialog for a raised notice and clears it on Ok', () => {
    render(<NoticeProvider><Raiser /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise' }));
    expect(screen.getByText('Welcome, Ada!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ok' }));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('throws when useNotice is used outside the provider', () => {
    expect(() => render(<Raiser />)).toThrow(/NoticeProvider/);
  });
});
```

(If the jsdom `showModal` stub was needed in Task 4, copy the same stub to the top of this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/NoticeProvider.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useNotice.ts`:

```ts
import { createContext, useContext } from 'react';

export type Notice = { message: string; title?: string };

export type NoticeContextValue = {
  notice: Notice | null;
  show: (notice: Notice) => void;
  clear: () => void;
};

// The provider (components/NoticeProvider) supplies the value; consumers read it via the
// useNotice hook. Context + hook live here (no component) so the provider file can satisfy
// react-refresh's component-only-export rule — same split as AuthContext/useAuth.
export const NoticeContext = createContext<NoticeContextValue | null>(null);

export function useNotice(): NoticeContextValue {
  const context = useContext(NoticeContext);
  if (!context) {
    throw new Error('useNotice must be used within a NoticeProvider');
  }
  return context;
}
```

- [ ] **Step 4: Implement the provider**

Create `frontend/src/components/NoticeProvider.tsx`:

```tsx
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { NoticeContext } from '../hooks/useNotice';
import type { Notice } from '../hooks/useNotice';
import NoticeDialog from './NoticeDialog';

// App-level host for the NoticeDialog. Pages raise notices through useNotice(); rendering
// the dialog here lets it survive route changes — a register success redirects away from
// /register (RequireAnon) the moment auth state flips, which would unmount a page-local
// dialog before the user saw it.
function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  const show = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
  }, []);

  const value = useMemo(() => ({ notice, show, clear }), [notice, show, clear]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notice ? <NoticeDialog message={notice.message} title={notice.title} onClose={clear} /> : null}
    </NoticeContext.Provider>
  );
}

export default NoticeProvider;
```

- [ ] **Step 5: Mount it in App.tsx**

In `frontend/src/App.tsx`, add the import and wrap `PageLayout`:

```tsx
import NoticeProvider from './components/NoticeProvider';
```

```tsx
      <AuthProvider>
        <NoticeProvider>
          <PageLayout>
            <Routes>
              ...unchanged routes...
            </Routes>
          </PageLayout>
        </NoticeProvider>
      </AuthProvider>
```

- [ ] **Step 6: Run the new suite plus App tests**

Run: `npm test -- tests/components/NoticeProvider.test.tsx tests/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useNotice.ts frontend/src/components/NoticeProvider.tsx frontend/src/App.tsx frontend/tests/components/NoticeProvider.test.tsx
git commit -m "feat(ui): app-level notice provider so dialogs survive auth redirects"
```

---

### Task 6: LoginPage rework

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/tests/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `AuthModel.validateLogin(values, touched?)` (Task 2), `AuthField` with `onBlur` (Task 3), `useNotice` (Task 5), existing `useAuth`.
- Produces: `/login` page — heading `Log in`, fields `E-mail` + `Password`, button `Login`, link `No account? Register here....` → `/register`. Behavior: blur validation, submit disabled while errors exist, fieldset disabled in flight, 401 → inline `Email or password is incorrect.`, network error → NoticeDialog `Failed to log in. Please try again.`, success → navigate `/`.

- [ ] **Step 1: Rewrite the failing tests**

Replace `frontend/tests/pages/LoginPage.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import LoginPage from '../../src/pages/LoginPage';

afterEach(cleanup);

// Surfaces the current route in the DOM so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderLogin(loginResult: AuthResult) {
  const login = vi.fn().mockResolvedValue(loginResult);
  const value: AuthContextValue = {
    status: 'anonymous',
    user: null,
    register: vi.fn(),
    login,
    logout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <LocationProbe />
          <LoginPage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return login;
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

const okResult: AuthResult = {
  ok: true,
  user: {
    id: 1,
    name: 'Ada',
    email: 'ada@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

describe('LoginPage', () => {
  it('validates client-side on submit before calling the API', async () => {
    const login = renderLogin(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('E-mail is required.')).toBeTruthy();
    expect(screen.getByText('Password is required.')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('validates a field on blur and gates the submit button on errors', async () => {
    renderLogin(okResult);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-email' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login' })).toHaveProperty('disabled', true);
  });

  it('re-enables submit once a blur-flagged field is corrected', async () => {
    renderLogin(okResult);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-email' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));
    await screen.findByText('Enter a valid email address.');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada@example.com' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));

    await waitFor(() => expect(screen.queryByText('Enter a valid email address.')).toBeNull());
    expect(screen.getByRole('button', { name: 'Login' })).toHaveProperty('disabled', false);
  });

  it('navigates home after a successful login', async () => {
    const login = renderLogin(okResult);

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'Password1' });
  });

  it('shows one non-disclosing message on an authentication failure', async () => {
    renderLogin({ ok: false, kind: 'auth' });

    fillCredentials('ada@example.com', 'WrongPass1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('merges server 422 field errors into the form', async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Server says no.')).toBeTruthy();
  });

  it('raises a notice dialog on a network failure', async () => {
    renderLogin({ ok: false, kind: 'network' });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Failed to log in. Please try again.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('links to the register page', () => {
    renderLogin(okResult);

    const link = screen.getByRole('link', { name: 'No account? Register here....' });
    expect(link.getAttribute('href')).toBe('/register');
  });
});
```

(If the jsdom `showModal` stub was needed in Task 4, copy it here too.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- tests/pages/LoginPage.test.tsx`
Expected: FAIL — labels/button/link/blur behavior not implemented yet.

- [ ] **Step 3: Implement**

Replace `frontend/src/pages/LoginPage.tsx` with:

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

const LOGIN_FIELDS = ['email', 'password'];

// Login form, prototype-style: fields validate on blur, the submit button is gated while
// client errors exist, and the whole fieldset is disabled during the request. A failed
// authentication (401) shows a single non-disclosing message — never revealing whether
// the email or the password was wrong (FR-003). Unexpected failures raise the app-level
// NoticeDialog. The password is never repopulated (FR-018).
function LoginPage() {
  const { login } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setErrors(AuthModel.validateLogin({ email, password }, nextTouched));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched(new Set(LOGIN_FIELDS));
    const values = { email, password };
    const clientErrors = AuthModel.validateLogin(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = await login(values);
    setSubmitting(false);
    if (result.ok) {
      navigate('/');
      return;
    }
    if (result.kind === 'validation') {
      setErrors(AuthModel.mergeServerErrors({}, result.errors));
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Email or password is incorrect.');
      return;
    }
    show({ message: 'Failed to log in. Please try again.' });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="auth">
      <h1>Log in</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <fieldset disabled={submitting}>
          <AuthField
            id="email"
            label="E-mail"
            type="email"
            value={email}
            autoComplete="email"
            error={errors.email?.join('\n')}
            onChange={setEmail}
            onBlur={() => handleBlur('email')}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            error={errors.password?.join('\n')}
            onChange={setPassword}
            onBlur={() => handleBlur('password')}
          />
          <button type="submit" disabled={submitting || hasErrors}>Login</button>
        </fieldset>
        <p className="auth-form__link"><Link to="/register">No account? Register here....</Link></p>
      </form>
    </section>
  );
}

export default LoginPage;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pages/LoginPage.test.tsx tests/App.test.tsx`
Expected: PASS (App.test still finds the `Log in` heading on the redirect test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/tests/pages/LoginPage.test.tsx
git commit -m "feat(auth): prototype-style login page (blur validation, gated submit, link)"
```

---

### Task 7: RegisterPage rework

**Files:**
- Modify: `frontend/src/pages/RegisterPage.tsx`
- Test: `frontend/tests/pages/RegisterPage.test.tsx`

**Interfaces:**
- Consumes: `AuthModel.validateRegister(values, touched?)` (Task 2), `AuthField` (Task 3), `useNotice` (Task 5).
- Produces: `/register` page — heading `Sign up`, fields `Display name` / `E-mail` / `Password` / `Re-type password`, button `Register`, link `Already have an account? Login here....` → `/login`. Success raises `Welcome, {name}! Your account is ready.` via NoticeDialog and navigates home; network errors raise `Failed to sign up. Please try again.`.

- [ ] **Step 1: Rewrite the failing tests**

Replace `frontend/tests/pages/RegisterPage.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import RegisterPage from '../../src/pages/RegisterPage';

afterEach(cleanup);

// Surfaces the current route in the DOM so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderRegister(registerResult: AuthResult) {
  const register = vi.fn().mockResolvedValue(registerResult);
  const value: AuthContextValue = {
    status: 'anonymous',
    user: null,
    register,
    login: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <LocationProbe />
          <RegisterPage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return register;
}

function fillForm(confirmation = 'Password1') {
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
  fireEvent.change(screen.getByLabelText('Re-type password'), { target: { value: confirmation } });
}

const okResult: AuthResult = {
  ok: true,
  user: {
    id: 1,
    name: 'Ada',
    email: 'ada@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

describe('RegisterPage', () => {
  it('validates client-side on submit before calling the API', async () => {
    const register = renderRegister(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Display name is required.')).toBeTruthy();
    expect(screen.getByText('E-mail is required.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('shows password-policy violations on blur, one per line, and gates submit', async () => {
    renderRegister(okResult);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.blur(screen.getByLabelText('Password'));

    const error = await screen.findByText(/must be at least 8 characters/);
    expect(error.textContent).toContain('must contain at least one number');
    expect(screen.getByRole('button', { name: 'Register' })).toHaveProperty('disabled', true);
  });

  it('flags a mismatched password confirmation without calling the API', async () => {
    const register = renderRegister(okResult);

    fillForm('Different1');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('welcomes the user in a dialog and navigates home on success', async () => {
    const register = renderRegister(okResult);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Welcome, Ada! Your account is ready.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(register).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'Password1',
      passwordConfirmation: 'Password1',
    });
  });

  it('merges server 422 field errors into the form (server wins)', async () => {
    renderRegister({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email has already been taken.'] },
    });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('The email has already been taken.')).toBeTruthy();
  });

  it('raises a notice dialog on a network failure', async () => {
    renderRegister({ ok: false, kind: 'network' });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Failed to sign up. Please try again.')).toBeTruthy();
  });

  it('links to the login page', () => {
    renderRegister(okResult);

    const link = screen.getByRole('link', { name: 'Already have an account? Login here....' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});
```

(If the jsdom `showModal` stub was needed in Task 4, copy it here too.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- tests/pages/RegisterPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `frontend/src/pages/RegisterPage.tsx` with:

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

const REGISTER_FIELDS = ['name', 'email', 'password', 'passwordConfirmation'];

// Registration form, prototype-style: fields validate on blur, the submit button is gated
// while client errors exist, and the fieldset is disabled during the request. The server
// stays authoritative and its 422 field errors are merged in (server wins). Success raises
// the app-level welcome dialog — it must outlive this page, because the auth-state flip
// makes RequireAnon redirect home immediately. Passwords are never repopulated (FR-018).
function RegisterPage() {
  const { register } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    const values = { name, email, password, passwordConfirmation };
    setErrors(AuthModel.validateRegister(values, nextTouched));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched(new Set(REGISTER_FIELDS));
    const values = { name, email, password, passwordConfirmation };
    const clientErrors = AuthModel.validateRegister(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await register(values);
    setSubmitting(false);
    if (result.ok) {
      show({ message: `Welcome, ${result.user.name}! Your account is ready.` });
      navigate('/');
      return;
    }
    if (result.kind === 'validation') {
      setErrors(AuthModel.mergeServerErrors({}, result.errors));
      return;
    }
    show({ message: 'Failed to sign up. Please try again.' });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="auth">
      <h1>Sign up</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={submitting}>
          <AuthField
            id="name"
            label="Display name"
            type="text"
            value={name}
            autoComplete="name"
            error={errors.name?.join('\n')}
            onChange={setName}
            onBlur={() => handleBlur('name')}
          />
          <AuthField
            id="email"
            label="E-mail"
            type="email"
            value={email}
            autoComplete="email"
            error={errors.email?.join('\n')}
            onChange={setEmail}
            onBlur={() => handleBlur('email')}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="new-password"
            error={errors.password?.join('\n')}
            onChange={setPassword}
            onBlur={() => handleBlur('password')}
          />
          <AuthField
            id="password-confirmation"
            label="Re-type password"
            type="password"
            value={passwordConfirmation}
            autoComplete="new-password"
            error={errors.passwordConfirmation?.join('\n')}
            onChange={setPasswordConfirmation}
            onBlur={() => handleBlur('passwordConfirmation')}
          />
          <button type="submit" disabled={submitting || hasErrors}>Register</button>
        </fieldset>
        <p className="auth-form__link"><Link to="/login">Already have an account? Login here....</Link></p>
      </form>
    </section>
  );
}

export default RegisterPage;
```

Note: unlike LoginPage there is no `formError` banner here — 422 errors are field-scoped and everything else goes through the NoticeDialog, so a form-level banner would be dead code.

- [ ] **Step 4: Run the full unit suite with coverage**

Run: `npm test -- --coverage`
Expected: PASS, all suites; coverage ≥90% overall (new provider/dialog/pages are covered by their suites).

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: exit 0. (If `formError` on RegisterPage trips `no-unused-vars`-style rules, apply the note in Step 3.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RegisterPage.tsx frontend/tests/pages/RegisterPage.test.tsx
git commit -m "feat(auth): prototype-style register page with welcome dialog"
```

---

### Task 8: E2E spec update + full gates

**Files:**
- Modify: `frontend/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: the pages from Tasks 6–7 (new labels `Display name`/`E-mail`/`Re-type password`, button `Login`, welcome dialog with `Ok`).
- Produces: green Playwright suite against the isolated e2e stack.

- [ ] **Step 1: Update the selectors and the register helper**

In `frontend/e2e/auth.spec.ts`:

Replace the `register` helper with (the welcome dialog must be dismissed — `showModal` makes the rest of the page inert):

```ts
async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E User');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E User! Your account is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();
}
```

In the login test (`login authenticates...`) and the wrong-credentials test, replace:
- `page.getByLabel('Email')` → `page.getByLabel('E-mail')`
- `page.getByRole('button', { name: 'Log in' })` → `page.getByRole('button', { name: 'Login' })`

(`getByLabel('Password', { exact: true })` stays — it already excludes `Re-type password`.)

- [ ] **Step 2: Run the e2e suite on the isolated stack**

From the repo root: `powershell -File scripts\e2e.ps1`
Expected: all Playwright specs PASS (auth, feed, upload, logo-parity).

- [ ] **Step 3: Run both stacks' full gates**

- `cd frontend; npm run lint` → exit 0
- `cd frontend; npm test -- --coverage` → PASS, ≥90%
- Backend untouched, but confirm nothing leaked: `git status` shows only intended files.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/auth.spec.ts
git commit -m "test(e2e): align auth specs with prototype labels and welcome dialog"
```

---

### Task 9: Visual parity check against the reference screenshots

**Files:**
- None modified (verification only; fix-ups go into `theme.css` if needed).

- [ ] **Step 1: Bring up the dev stack and reload the frontend**

From the repo root: `docker compose up -d`, then `docker compose restart frontend` (Vite can serve stale UI after merges/edits).

- [ ] **Step 2: Screenshot /login and /register**

Use Playwright directly (dev stack URL per `docker-compose.yml`, typically `http://localhost:5173`):

```powershell
cd frontend
npx playwright screenshot --viewport-size "1280,900" http://localhost:5173/login ..\docs\superpowers\plans\verify-login.png
npx playwright screenshot --viewport-size "1280,900" http://localhost:5173/register ..\docs\superpowers\plans\verify-register.png
```

- [ ] **Step 3: Compare against `docs/login.png` and `docs/signup.png`**

Check: centered ~600px column; heading with hairline; placeholder-only look; full-width outlined inputs (4px radius) and button (10px radius); no red anywhere except error text; centered link(s) below the form; dark scheme matches. Fix deviations in `theme.css`, re-screenshot, and delete the `verify-*.png` files afterward (they are scratch, not repo assets).

- [ ] **Step 4: Commit any fix-ups**

```bash
git add frontend/src/styles/theme.css
git commit -m "style(auth): visual parity fix-ups against prototype screenshots"
```

(Skip the commit if no fix-ups were needed.)
