import { describe, expect, it } from 'vitest';

import type { AuthUser } from '../../src/lib/authApi';
import { AuthModel } from '../../src/lib/authModel';

const validRegister = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Password1',
  passwordConfirmation: 'Password1',
};

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

describe('mergeServerErrors', () => {
  it('lets server errors win and keeps client-only fields', () => {
    const merged = AuthModel.mergeServerErrors(
      { email: ['client email msg'], name: ['client name msg'] },
      { email: ['server email msg'], password: ['server password msg'] },
    );

    expect(merged).toEqual({
      name: ['client name msg'],
      email: ['server email msg'],
      password: ['server password msg'],
    });
  });
});

describe('clearFieldError', () => {
  it('removes only the named key', () => {
    const errors = { email: ['server email msg'], password: ['server password msg'] };
    expect(AuthModel.clearFieldError(errors, 'email')).toEqual({
      password: ['server password msg'],
    });
  });

  it('returns an equal-content object when the key is absent', () => {
    const errors = { password: ['server password msg'] };
    expect(AuthModel.clearFieldError(errors, 'email')).toEqual(errors);
  });
});

describe('resolveStatus', () => {
  it('is authenticated when a user is present', () => {
    const user = { hash: 'usr0000001', name: 'A', email: 'a@b.c', emailVerifiedAt: null, createdAt: '', updatedAt: '' };
    expect(AuthModel.resolveStatus(user)).toBe('authenticated');
  });

  it('is anonymous when there is no user', () => {
    expect(AuthModel.resolveStatus(null)).toBe('anonymous');
  });
});

describe('parseVerifyParams', () => {
  const query = new URLSearchParams({ expires: '1767225600', signature: 'deadbeef' });

  it('extracts the link components from the route param and query', () => {
    expect(AuthModel.parseVerifyParams('abc123', query)).toEqual({
      hash: 'abc123',
      expires: '1767225600',
      signature: 'deadbeef',
    });
  });

  it('returns null when the hash segment is missing or blank', () => {
    expect(AuthModel.parseVerifyParams(undefined, query)).toBeNull();
    expect(AuthModel.parseVerifyParams('  ', query)).toBeNull();
  });

  it('returns null when expires is missing or blank', () => {
    expect(AuthModel.parseVerifyParams('abc123', new URLSearchParams({ signature: 'deadbeef' }))).toBeNull();
    expect(AuthModel.parseVerifyParams(
      'abc123',
      new URLSearchParams({ expires: ' ', signature: 'deadbeef' }),
    )).toBeNull();
  });

  it('returns null when the signature is missing or blank', () => {
    expect(AuthModel.parseVerifyParams('abc123', new URLSearchParams({ expires: '1767225600' }))).toBeNull();
    expect(AuthModel.parseVerifyParams(
      'abc123',
      new URLSearchParams({ expires: '1767225600', signature: '' }),
    )).toBeNull();
  });
});

describe('verifyViewState', () => {
  const ada = {
    hash: 'usr0000001',
    name: 'Ada',
    email: 'ada@example.com',
    emailVerifiedAt: '2026-07-07T10:00:00Z',
    createdAt: '',
    updatedAt: '',
  };

  it('maps a fresh verification to confirmed', () => {
    expect(AuthModel.verifyViewState({ ok: true, user: ada, alreadyVerified: false })).toBe('confirmed');
  });

  it('maps an idempotent re-use to already', () => {
    expect(AuthModel.verifyViewState({ ok: true, user: ada, alreadyVerified: true })).toBe('already');
  });

  it('maps every failure kind to failed', () => {
    expect(AuthModel.verifyViewState({ ok: false, kind: 'invalid' })).toBe('failed');
    expect(AuthModel.verifyViewState({ ok: false, kind: 'rate-limited' })).toBe('failed');
    expect(AuthModel.verifyViewState({ ok: false, kind: 'network' })).toBe('failed');
  });
});

describe('resendFeedback', () => {
  it('confirms a sent message', () => {
    expect(AuthModel.resendFeedback({ ok: true })).toBe('Verification link sent. Check your inbox.');
  });

  it('tells an already-verified user there is nothing to send', () => {
    expect(AuthModel.resendFeedback({ ok: false, kind: 'already-verified' }))
      .toBe('Your e-mail is already verified.');
  });

  it('tells a rate-limited user to try again in a minute', () => {
    expect(AuthModel.resendFeedback({ ok: false, kind: 'rate-limited' }))
      .toBe('Too many attempts. Please try again in a minute.');
  });

  it('reports a network failure as retryable', () => {
    expect(AuthModel.resendFeedback({ ok: false, kind: 'network' }))
      .toBe('Something went wrong. Please check your connection and try again.');
  });
});

// Feature 017 (FR-029): the account page states in WORDS which doors the account has —
// the only disclosure that a Google link was auto-attached to a pre-existing account.
describe('signInMethod', () => {
  const account: AuthUser = {
    hash: 'usr0000001',
    name: 'Ada',
    email: 'ada@example.com',
    emailVerifiedAt: '2026-07-07T10:00:00Z',
    role: 'member',
    createdAt: '',
    updatedAt: '',
    hasPassword: true,
    googleLinkedAt: null,
  };

  it('names Google alone for a passwordless linked account', () => {
    expect(AuthModel.signInMethod({ ...account, hasPassword: false, googleLinkedAt: '2026-07-29T09:00:00Z' }))
      .toBe('Google');
  });

  it('names e-mail and password for an unlinked password account', () => {
    expect(AuthModel.signInMethod(account)).toBe('Email and password');
  });

  it('names both for an account carrying both doors', () => {
    expect(AuthModel.signInMethod({ ...account, googleLinkedAt: '2026-07-29T09:00:00Z' }))
      .toBe('Google and email/password');
  });

  // Unreachable in practice — an account with neither door could not have been created —
  // but the function is total, and the fallback names the door the site started with.
  it('falls back to e-mail and password when the account claims neither door', () => {
    expect(AuthModel.signInMethod({ ...account, hasPassword: false })).toBe('Email and password');
  });
});

describe('verifyFailureMessage', () => {
  it('explains an invalid or expired link', () => {
    expect(AuthModel.verifyFailureMessage('invalid')).toBe('This verification link is invalid or expired.');
  });

  it('tells a rate-limited user to try again in a minute', () => {
    expect(AuthModel.verifyFailureMessage('rate-limited')).toBe('Too many attempts. Please try again in a minute.');
  });

  it('reports a network failure as retryable', () => {
    expect(AuthModel.verifyFailureMessage('network'))
      .toBe('Something went wrong. Please check your connection and try again.');
  });
});
