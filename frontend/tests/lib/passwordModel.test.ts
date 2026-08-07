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

// The token arrives in the URL FRAGMENT, which no server ever sees (research D2). Reading
// it is the page's first act, and a fragment it cannot read means a link that can never
// work — so the page refuses locally instead of issuing a doomed request.
describe('parseResetFragment', () => {
  it('reads the token out of a well-formed fragment', () => {
    expect(PasswordModel.parseResetFragment('#token=a1b2c3')).toBe('a1b2c3');
  });

  it('reads it whether or not the leading hash is present', () => {
    expect(PasswordModel.parseResetFragment('token=a1b2c3')).toBe('a1b2c3');
  });

  it('returns null for an absent fragment', () => {
    expect(PasswordModel.parseResetFragment('')).toBeNull();
    expect(PasswordModel.parseResetFragment('#')).toBeNull();
  });

  it('returns null for a fragment carrying no token', () => {
    expect(PasswordModel.parseResetFragment('#other=a1b2c3')).toBeNull();
  });

  it('returns null for an empty or whitespace-only token', () => {
    expect(PasswordModel.parseResetFragment('#token=')).toBeNull();
    expect(PasswordModel.parseResetFragment('#token=%20')).toBeNull();
  });
});

describe('validateReset', () => {
  const good = { password: 'NewPassw0rd', passwordConfirmation: 'NewPassw0rd' };

  it('accepts a compliant, matching pair', () => {
    expect(PasswordModel.validateReset(good)).toEqual({});
  });

  it('reports the same policy violations the register form does', () => {
    // One policy, one wording — the reset form cannot be stricter or looser than the rule
    // the account was created under (FR-013).
    expect(PasswordModel.validateReset({ password: 'short', passwordConfirmation: 'short' }).password)
      .toEqual(PasswordModel.policyErrors('short'));
  });

  it('reports a missing password as required', () => {
    expect(PasswordModel.validateReset({ password: '', passwordConfirmation: '' }).password)
      .toEqual(['Password is required.']);
  });

  it('reports a mismatched confirmation', () => {
    expect(PasswordModel.validateReset({ password: 'NewPassw0rd', passwordConfirmation: 'Other1234' }))
      .toEqual({ passwordConfirmation: ['Passwords do not match.'] });
  });

  it('reports a missing confirmation as required', () => {
    expect(PasswordModel.validateReset({ password: 'NewPassw0rd', passwordConfirmation: '' }))
      .toEqual({ passwordConfirmation: ['Re-type password is required.'] });
  });

  it('judges only the fields already visited, like the other validators', () => {
    expect(PasswordModel.validateReset({ password: 'short', passwordConfirmation: '' }, new Set())).toEqual({});
  });

  it('judges a visited field once it has been visited', () => {
    expect(PasswordModel.validateReset({ password: 'short', passwordConfirmation: '' }, new Set(['password'])))
      .toHaveProperty('password');
  });
});

describe('resetFailureMessage', () => {
  it('states a dead link in one plain sentence, naming no account', () => {
    const sentence = PasswordModel.resetFailureMessage('invalid');

    expect(sentence).toBe('This password recovery link is no longer valid.');
    expect(sentence).not.toContain('@');
  });

  it.each(['rate-limited', 'network'] as const)('reuses the shared sentence for %s', (kind) => {
    expect(PasswordModel.resetFailureMessage(kind)).toBe(PasswordModel.requestFailureMessage(kind));
  });
});
