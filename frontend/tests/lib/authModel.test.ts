import { describe, expect, it } from 'vitest';

import {
  mergeServerErrors,
  resolveStatus,
  validateLogin,
  validateRegister,
} from '../../src/lib/authModel';

const validRegister = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Password1',
  passwordConfirmation: 'Password1',
};

describe('validateRegister', () => {
  it('returns no errors for valid input', () => {
    expect(validateRegister(validRegister)).toEqual({});
  });

  it('flags a missing name', () => {
    expect(validateRegister({ ...validRegister, name: '  ' }).name).toBeDefined();
  });

  it('flags a malformed email', () => {
    expect(validateRegister({ ...validRegister, email: 'not-an-email' }).email).toBeDefined();
  });

  it('flags a password that is too short or lacks variety', () => {
    expect(validateRegister({ ...validRegister, password: 'short', passwordConfirmation: 'short' }).password).toBeDefined();
    expect(validateRegister({ ...validRegister, password: 'alllowercase1', passwordConfirmation: 'alllowercase1' }).password).toBeDefined();
    expect(validateRegister({ ...validRegister, password: 'NoNumbersHere', passwordConfirmation: 'NoNumbersHere' }).password).toBeDefined();
  });

  it('flags a confirmation that does not match', () => {
    expect(validateRegister({ ...validRegister, passwordConfirmation: 'Different1' }).passwordConfirmation).toBeDefined();
  });
});

describe('validateLogin', () => {
  it('returns no errors for valid input', () => {
    expect(validateLogin({ email: 'ada@example.com', password: 'whatever' })).toEqual({});
  });

  it('flags a missing email and password', () => {
    const errors = validateLogin({ email: '', password: '' });
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });
});

describe('mergeServerErrors', () => {
  it('lets server errors win and keeps client-only fields', () => {
    const merged = mergeServerErrors(
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

describe('resolveStatus', () => {
  it('is authenticated when a user is present', () => {
    expect(resolveStatus({ id: 1, name: 'A', email: 'a@b.c', createdAt: '', updatedAt: '' })).toBe('authenticated');
  });

  it('is anonymous when there is no user', () => {
    expect(resolveStatus(null)).toBe('anonymous');
  });
});
