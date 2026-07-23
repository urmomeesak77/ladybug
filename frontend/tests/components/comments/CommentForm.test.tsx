// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentForm from '../../../src/components/comments/CommentForm';
import { AuthContext } from '../../../src/hooks/useAuth';
import type { AuthContextValue } from '../../../src/hooks/useAuth';
import type { RoleName } from '../../../src/lib/role';

afterEach(cleanup);

// A minimal AuthContext value. `verified` toggles emailVerifiedAt for the signed-in cases.
function auth(role: RoleName, verified = true): AuthContextValue {
  return {
    status: role === 'guest' ? 'anonymous' : 'authenticated',
    user: role === 'guest' ? null : {
      hash: 'u000000001', name: 'Alice', email: 'a@example.test',
      emailVerifiedAt: verified ? '2026-07-01T00:00:00Z' : null, role, createdAt: '', updatedAt: '',
    },
    role,
    register: async () => ({ ok: true, user: null as never }),
    login: async () => ({ ok: true, user: null as never }),
    logout: async () => {},
    refresh: async () => {},
  };
}

function renderForm(value: AuthContextValue, onSubmit = vi.fn(async () => ({ ok: true as const, comment: null as never }))) {
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <CommentForm onSubmit={onSubmit} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { onSubmit };
}

describe('CommentForm gating', () => {
  it('shows a sign-in prompt with a link for a guest', () => {
    renderForm(auth('guest'));
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveProperty('href', expect.stringContaining('/login'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a verify-e-mail prompt for a signed-in unverified user', () => {
    renderForm(auth('member', false));
    expect(screen.getByRole('link', { name: /verify/i })).toHaveProperty('href', expect.stringContaining('/verify-email'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the labelled composer for a verified user', () => {
    renderForm(auth('member'));
    expect(screen.getByLabelText(/add a comment/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /post comment/i })).toBeTruthy();
  });
});

describe('CommentForm submission', () => {
  it('rejects an empty body inline without calling onSubmit', () => {
    const { onSubmit } = renderForm(auth('member'));
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
    expect(screen.getByText(/comment cannot be empty/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a valid body and clears the field', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, comment: null as never }));
    renderForm(auth('member'), onSubmit);
    const box = screen.getByLabelText(/add a comment/i) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Nice meme!' } });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Nice meme!'));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('surfaces a server validation error and keeps the text', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, kind: 'validation' as const, errors: { body: ['The body field is required.'] } }));
    renderForm(auth('member'), onSubmit);
    const box = screen.getByLabelText(/add a comment/i) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'oops' } });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
    await waitFor(() => expect(screen.getByText('The body field is required.')).toBeTruthy());
    expect(box.value).toBe('oops');
  });

  it('rejects a body over the length limit inline without calling onSubmit', () => {
    const { onSubmit } = renderForm(auth('member'));
    const box = screen.getByLabelText(/add a comment/i) as HTMLTextAreaElement;
    // fireEvent.change sets the value directly, past the textarea maxLength.
    fireEvent.change(box, { target: { value: 'a'.repeat(1001) } });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
    expect(screen.getByText(/1000 characters or fewer/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('maps each failure kind to its own message', async () => {
    const cases = [
      [{ ok: false as const, kind: 'validation' as const, errors: {} }, /could not be posted/i],
      [{ ok: false as const, kind: 'rateLimited' as const }, /too quickly/i],
      [{ ok: false as const, kind: 'auth' as const }, /sign in again/i],
      [{ ok: false as const, kind: 'unverified' as const }, /verify your e-mail/i],
      [{ ok: false as const, kind: 'notFound' as const }, /no longer available/i],
      [{ ok: false as const, kind: 'network' as const }, /something went wrong/i],
    ] as const;
    for (const [result, matcher] of cases) {
      const onSubmit = vi.fn(async () => result);
      const { unmount } = render(
        <AuthContext.Provider value={auth('member')}>
          <MemoryRouter>
            <CommentForm onSubmit={onSubmit} />
          </MemoryRouter>
        </AuthContext.Provider>,
      );
      const box = screen.getByLabelText(/add a comment/i) as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: 'text' } });
      fireEvent.click(screen.getByRole('button', { name: /post comment/i }));
      await waitFor(() => expect(screen.getByText(matcher)).toBeTruthy());
      unmount();
    }
  });
});
