import { describe, expect, it } from 'vitest';

import { AuthModel } from '../../src/lib/authModel';
import { PasswordModel } from '../../src/lib/passwordModel';

// The client mirror of the server's PasswordPolicy (backend/app/Support/PasswordPolicy.php).
// These messages are byte-equal to the ones Laravel's Password rule produces, so a field
// flagged before submit and the same field flagged by the server read identically.
describe('policyErrors', () => {
  it('returns no errors for a password meeting every clause', () => {
    expect(PasswordModel.policyErrors('Password1')).toEqual([]);
  });

  it('reports an empty password as required, and nothing else', () => {
    expect(PasswordModel.policyErrors('')).toEqual(['Password is required.']);
  });

  it('flags a password under eight characters', () => {
    expect(PasswordModel.policyErrors('Pass1')).toContain(
      'The password field must be at least 8 characters.',
    );
  });

  it('flags a lowercase-only password', () => {
    expect(PasswordModel.policyErrors('password1')).toContain(
      'The password field must contain at least one uppercase and one lowercase letter.',
    );
  });

  it('flags an uppercase-only password', () => {
    expect(PasswordModel.policyErrors('PASSWORD1')).toContain(
      'The password field must contain at least one uppercase and one lowercase letter.',
    );
  });

  it('flags a password without a digit', () => {
    expect(PasswordModel.policyErrors('Passwords')).toContain(
      'The password field must contain at least one number.',
    );
  });

  it('reports every violation of a wholly non-compliant password at once', () => {
    expect(PasswordModel.policyErrors('short')).toEqual([
      'The password field must be at least 8 characters.',
      'The password field must contain at least one uppercase and one lowercase letter.',
      'The password field must contain at least one number.',
    ]);
  });
});

describe('requestFailureMessage', () => {
  it('states a spent rate limit in one plain sentence', () => {
    expect(PasswordModel.requestFailureMessage('rate-limited'))
      .toBe('Too many attempts. Please try again in a minute.');
  });

  it('states a failed round trip in one plain sentence', () => {
    expect(PasswordModel.requestFailureMessage('network'))
      .toBe('Something went wrong. Please check your connection and try again.');
  });

  it('names no account in either sentence', () => {
    // FR-004 reaches the failure paths too: neither of these failures knows of an
    // account, and neither may sound as though it does.
    const sentences = [
      PasswordModel.requestFailureMessage('rate-limited'),
      PasswordModel.requestFailureMessage('network'),
    ];

    expect(sentences.join(' ')).not.toContain('@');
    expect(sentences.join(' ')).not.toContain('account');
  });

  it.each(['rate-limited', 'network'] as const)('says the same as the verification flow for %s', (kind) => {
    // Compared against what the site already renders rather than a repeated literal, so
    // one wording changing without the other has to fail here.
    expect(PasswordModel.requestFailureMessage(kind)).toBe(AuthModel.verifyFailureMessage(kind));
  });
});
