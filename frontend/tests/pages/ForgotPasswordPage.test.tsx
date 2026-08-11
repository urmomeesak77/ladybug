// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordApi } from '../../src/lib/passwordApi';
import type { RequestLinkResult } from '../../src/lib/passwordApi';
import ForgotPasswordPage from '../../src/pages/ForgotPasswordPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(result: RequestLinkResult = { ok: true }) {
  const requestLink = vi.spyOn(PasswordApi, 'requestLink').mockResolvedValue(result);
  render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  return requestLink;
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
}

const CONFIRMATION = 'If an account exists for that address, a password recovery link is on its way. '
  + 'Check that inbox.';

describe('ForgotPasswordPage', () => {
  it('renders the request form with a labelled address field', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send recovery link' })).toBeTruthy();
  });

  it('offers a way back to the sign-in form', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Back to login' }).getAttribute('href')).toBe('/login');
  });

  it('flags a malformed address inline and keeps what was typed', async () => {
    // US1 scenario 4: client validation is feedback, not a wall — the visitor must not
    // have to retype the address to correct one character of it.
    const requestLink = renderPage();

    submit('not-an-address');

    expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid email address.');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('not-an-address');
    expect(requestLink).not.toHaveBeenCalled();
  });

  it('flags an empty address inline without calling the API', async () => {
    const requestLink = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));

    expect((await screen.findByRole('alert')).textContent).toBe('E-mail is required.');
    expect(requestLink).not.toHaveBeenCalled();
  });

  it('validates on blur and gates the submit button, like the sign-in form', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-address' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send recovery link' })).toHaveProperty('disabled', true);
  });

  it('replaces the form with the confirmation once the request is accepted', async () => {
    const requestLink = renderPage({ ok: true });

    submit('ada@example.com');

    expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
    expect(requestLink).toHaveBeenCalledWith('ada@example.com');
    expect(screen.queryByRole('button', { name: 'Send recovery link' })).toBeNull();
    expect(screen.queryByLabelText('E-mail')).toBeNull();
  });

  it('shows the same confirmation for an address that has no account', async () => {
    // The page cannot tell the two apart, because PasswordApi resolves { ok: true } for
    // any 200 — the whole of FR-004 on the client side.
    renderPage({ ok: true });

    submit('nobody@example.com');

    expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
  });

  it('merges a server field error into the form', async () => {
    renderPage({ ok: false, kind: 'validation', errors: { email: ['The email field is required.'] } });

    submit('ada@example.com');

    expect(await screen.findByText('The email field is required.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send recovery link' })).toBeTruthy();
  });

  it('names no account when the requester is rate-limited', async () => {
    renderPage({ ok: false, kind: 'rate-limited' });

    submit('ada@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Too many attempts. Please try again in a minute.');
    expect(alert.textContent).not.toContain('ada@example.com');
  });

  it('names no account when the request cannot be delivered', async () => {
    renderPage({ ok: false, kind: 'network' });

    submit('ada@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something went wrong. Please check your connection and try again.');
    expect(alert.textContent).not.toContain('ada@example.com');
  });

  it('disables the form while the request is in flight', async () => {
    let resolve!: (result: RequestLinkResult) => void;
    const pending = new Promise<RequestLinkResult>((res) => { resolve = res; });
    vi.spyOn(PasswordApi, 'requestLink').mockReturnValue(pending);
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    submit('ada@example.com');

    const fieldset = screen.getByLabelText('E-mail').closest('fieldset');
    await waitFor(() => expect(fieldset?.disabled).toBe(true));

    resolve({ ok: true });

    expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
  });
});

/**
 * FR-023 wants every outcome announced, not merely printed. A live region has to be in the
 * accessibility tree BEFORE its text changes; one that appears already carrying its own
 * role="status" is generally not announced. It matters more here than elsewhere, because the
 * submit button the visitor activated is unmounted at the same moment, dropping focus to
 * <body> — so a silent swap leaves them with no signal at all that the request went through.
 */
describe('ForgotPasswordPage, announcing the outcome', () => {
  it('keeps one status region mounted from the first render and only changes its words', async () => {
    vi.spyOn(PasswordApi, 'requestLink').mockResolvedValue({ ok: true });
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    submit('ada@example.com');

    await screen.findByText(CONFIRMATION);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe(CONFIRMATION);
  });
});
