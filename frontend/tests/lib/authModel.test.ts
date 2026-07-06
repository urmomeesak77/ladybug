import { describe, expect, it } from 'vitest';

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
    const user = { id: 1, name: 'A', email: 'a@b.c', createdAt: '', updatedAt: '' };
    expect(AuthModel.resolveStatus(user)).toBe('authenticated');
  });

  it('is anonymous when there is no user', () => {
    expect(AuthModel.resolveStatus(null)).toBe('anonymous');
  });
});
