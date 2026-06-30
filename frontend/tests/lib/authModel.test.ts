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
    expect(AuthModel.validateRegister({ ...validRegister, name: '  ' }).name).toBeDefined();
  });

  it('flags a malformed email', () => {
    expect(AuthModel.validateRegister({ ...validRegister, email: 'not-an-email' }).email).toBeDefined();
  });

  it('flags a password that is too short or lacks variety', () => {
    for (const password of ['short', 'alllowercase1', 'NoNumbersHere']) {
      const errors = AuthModel.validateRegister({ ...validRegister, password, passwordConfirmation: password });
      expect(errors.password).toBeDefined();
    }
  });

  it('flags a confirmation that does not match', () => {
    const errors = AuthModel.validateRegister({ ...validRegister, passwordConfirmation: 'Different1' });
    expect(errors.passwordConfirmation).toBeDefined();
  });
});

describe('validateLogin', () => {
  it('returns no errors for valid input', () => {
    expect(AuthModel.validateLogin({ email: 'ada@example.com', password: 'whatever' })).toEqual({});
  });

  it('flags a missing email and password', () => {
    const errors = AuthModel.validateLogin({ email: '', password: '' });
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
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

describe('resolveStatus', () => {
  it('is authenticated when a user is present', () => {
    const user = { id: 1, name: 'A', email: 'a@b.c', createdAt: '', updatedAt: '' };
    expect(AuthModel.resolveStatus(user)).toBe('authenticated');
  });

  it('is anonymous when there is no user', () => {
    expect(AuthModel.resolveStatus(null)).toBe('anonymous');
  });
});
