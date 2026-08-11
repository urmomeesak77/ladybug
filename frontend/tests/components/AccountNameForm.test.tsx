// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountNameForm from '../../src/components/AccountNameForm';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ada: AuthUser = {
  hash: 'usr0000001',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: null,
  role: 'member',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  hasPassword: true,
  googleLinkedAt: null,
};

function renderForm(name = 'Ada') {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const value: AuthContextValue = {
    status: 'authenticated',
    user: ada,
    role: 'member',
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh,
  };
  render(
    <AuthContext.Provider value={value}>
      <AccountNameForm name={name} />
    </AuthContext.Provider>,
  );
  return { refresh, input: screen.getByLabelText('Name') as HTMLInputElement };
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('AccountNameForm', () => {
  it('seeds the field with the stored name and cannot be saved unchanged', () => {
    const { input } = renderForm();

    expect(input.value).toBe('Ada');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses to submit a blank name', () => {
    const { input } = renderForm();

    fireEvent.change(input, { target: { value: '   ' } });

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the trimmed new name, reports it in words and refreshes the session', async () => {
    const update = vi.spyOn(AuthApi, 'updateName').mockResolvedValue({ ok: true, user: { ...ada, name: 'Grace' } });
    const { refresh, input } = renderForm();

    fireEvent.change(input, { target: { value: '  Grace  ' } });
    save();

    expect(await screen.findByText('Name updated.')).toBeTruthy();
    expect(update).toHaveBeenCalledWith('Grace');
    // The server's stored value wins over the typed draft.
    expect(input.value).toBe('Grace');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the server message when the name is already taken', async () => {
    vi.spyOn(AuthApi, 'updateName').mockResolvedValue({
      ok: false,
      kind: 'validation',
      errors: { name: ['That name is already taken.'] },
    });
    const { refresh, input } = renderForm();

    fireEvent.change(input, { target: { value: 'Grace' } });
    save();

    const error = await screen.findByText('That name is already taken.');
    // The refusal is text tied to the field, not colour alone (Principle IV).
    expect(input.getAttribute('aria-describedby')).toBe(error.getAttribute('id'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports a failed request and keeps the typed name', async () => {
    vi.spyOn(AuthApi, 'updateName').mockResolvedValue({ ok: false, kind: 'network' });
    const { input } = renderForm();

    fireEvent.change(input, { target: { value: 'Grace' } });
    save();

    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    expect(input.value).toBe('Grace');
  });

  it('clears the previous outcome as soon as the field is edited again', async () => {
    vi.spyOn(AuthApi, 'updateName').mockResolvedValue({ ok: false, kind: 'network' });
    const { input } = renderForm();

    fireEvent.change(input, { target: { value: 'Grace' } });
    save();
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Grace H' } });

    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it('shows a busy spinner and disables the field while the request runs', async () => {
    let finish!: (result: { ok: true; user: AuthUser }) => void;
    const pending = new Promise<{ ok: true; user: AuthUser }>((resolve) => { finish = resolve; });
    vi.spyOn(AuthApi, 'updateName').mockReturnValue(pending);
    const { input } = renderForm();

    fireEvent.change(input, { target: { value: 'Grace' } });
    save();

    const button = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
    // The whole fieldset is disabled during the request, which disables the field within it.
    expect((input.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);

    finish({ ok: true, user: { ...ada, name: 'Grace' } });

    expect(await screen.findByText('Name updated.')).toBeTruthy();
  });
});
