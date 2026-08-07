// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordApi } from '../../src/lib/passwordApi';
import type { CheckTokenResult, ResetResult } from '../../src/lib/passwordApi';
import ResetPasswordPage from '../../src/pages/ResetPasswordPage';

const DIGEST = '356a192b7913b04c54574d18c28d46e6395428ab';
const TOKEN = 'a'.repeat(64);
const LINK = `/reset-password/${DIGEST}#token=${TOKEN}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubApi(check: CheckTokenResult = { ok: true }, reset: ResetResult = { ok: true }) {
  return {
    checkToken: vi.spyOn(PasswordApi, 'checkToken').mockResolvedValue(check),
    reset: vi.spyOn(PasswordApi, 'reset').mockResolvedValue(reset),
  };
}

// The page reads its digest from the route and its token from the fragment, so it is
// mounted behind a real route rather than rendered bare.
function renderPage(entry = LINK) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reset-password/:hash" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
}

async function reachForm(check: CheckTokenResult = { ok: true }, reset: ResetResult = { ok: true }) {
  const api = stubApi(check, reset);
  renderPage();
  await screen.findByRole('heading', { name: 'Choose a new password' });
  return api;
}

describe('ResetPasswordPage', () => {
  it('checks the link once on mount, before anything can be typed', async () => {
    const api = stubApi();

    renderPage();

    expect(screen.getByRole('status').textContent).toBe('Checking this link…');
    await waitFor(() => expect(api.checkToken).toHaveBeenCalledWith(DIGEST, TOKEN));
    expect(api.checkToken).toHaveBeenCalledTimes(1);
  });

  it('shows the form once the link is confirmed live', async () => {
    await reachForm();

    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy();
  });

  it('asks for no current password and prints no account detail', async () => {
    // FR-011 / INV-7: whoever holds the link proves an inbox, not a password — and the page
    // must not tell them whose inbox it was. The digest is in the address bar and must not
    // be echoed into the page either.
    await reachForm();

    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(document.body.textContent).not.toContain('@');
    expect(document.body.textContent).not.toContain(DIGEST);
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('marks both inputs as new passwords so no manager fills the old one back in', async () => {
    await reachForm();

    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Confirm new password').getAttribute('autocomplete')).toBe('new-password');
  });

  it('submits the digest, the token and the new password together', async () => {
    const api = await reachForm();

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith({
      hash: DIGEST,
      token: TOKEN,
      password: 'NewPassw0rd',
      passwordConfirmation: 'NewPassw0rd',
    }));
  });

  it('confirms the change and points at the sign-in form, without signing anyone in', async () => {
    // FR-021: the reset route establishes no session, so the page has nothing to refresh
    // and no one to log in — it hands the user a link and stops.
    const api = await reachForm();

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Your password has been changed. Please log in.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to login' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('button', { name: 'Set password' })).toBeNull();
    expect(api.checkToken).toHaveBeenCalledTimes(1);
  });

  it('keeps the form alive and inline-flags the field when the server refuses the password', async () => {
    // US2 scenarios 3-4: a 422 is about the PASSWORD, so the link is untouched and the page
    // must still be usable — and must not re-check, which would spend rate-limit budget on
    // a link it already knows is good (research D8).
    const api = await reachForm({ ok: true }, { ok: false, kind: 'validation', errors: { password: ['too weak'] } });

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('too weak')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy();
    expect(api.checkToken).toHaveBeenCalledTimes(1);
  });

  it('flags a mismatched confirmation before troubling the server', async () => {
    const api = await reachForm();

    fill('NewPassw0rd', 'Other12345');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Passwords do not match.');
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('disables the form while the submission is in flight', async () => {
    stubApi();
    let resolve!: (result: ResetResult) => void;
    vi.spyOn(PasswordApi, 'reset').mockReturnValue(new Promise<ResetResult>((res) => { resolve = res; }));
    renderPage();
    await screen.findByRole('heading', { name: 'Choose a new password' });

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    const fieldset = screen.getByLabelText('New password').closest('fieldset');
    await waitFor(() => expect(fieldset?.disabled).toBe(true));

    resolve({ ok: true });

    expect(await screen.findByText('Your password has been changed. Please log in.')).toBeTruthy();
  });

  // FR-024. This is the one automated guard on research D3's decision NOT to strip the
  // fragment: a `history.replaceState` cleaning the URL would turn every live link dead on
  // reload, and the failure would look exactly like an expired link to the user. Remounting
  // at the same address with the same fragment is what a Refresh does.
  it('checks again and reaches the form when the same address is opened afresh', async () => {
    const api = stubApi();
    const first = renderPage();
    await screen.findByRole('heading', { name: 'Choose a new password' });

    first.unmount();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(api.checkToken).toHaveBeenNthCalledWith(2, DIGEST, TOKEN);
  });
});

// The refusal path US4 hardens further (T057-T061); the states it needs already exist here,
// because a page that renders nothing for a refused check is not shippable.
describe('ResetPasswordPage, dead links', () => {
  it('refuses a link the server will not honour, and offers a fresh one', async () => {
    stubApi({ ok: false, kind: 'invalid' });

    renderPage();

    expect(await screen.findByText('This password recovery link is no longer valid.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request a new link' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('refuses a link with no token in its fragment without asking the server', async () => {
    const api = stubApi();

    renderPage(`/reset-password/${DIGEST}`);

    expect(await screen.findByText('This password recovery link is no longer valid.')).toBeTruthy();
    expect(api.checkToken).not.toHaveBeenCalled();
  });

  it('refuses the link when the submission is answered with a dead-link refusal', async () => {
    await reachForm({ ok: true }, { ok: false, kind: 'invalid' });

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('This password recovery link is no longer valid.')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('keeps a rate-limited or unreachable submission on the form, since the link may still be good', async () => {
    await reachForm({ ok: true }, { ok: false, kind: 'rate-limited' });

    fill('NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Too many attempts. Please try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy();
  });
});
