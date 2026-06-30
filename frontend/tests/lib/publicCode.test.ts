import { describe, expect, it } from 'vitest';

import { PublicCode } from '../../src/lib/publicCode';

describe('publicCode.isValid', () => {
  it('accepts well-formed 11-character codes', () => {
    expect(PublicCode.isValid('ABC123XYZ-0')).toBe(true);
    expect(PublicCode.isValid('AAAAAAAAAAA')).toBe(true);
    expect(PublicCode.isValid('-----------')).toBe(true);
  });

  it('rejects codes of the wrong length', () => {
    expect(PublicCode.isValid('ABC123XYZ0')).toBe(false); // 10 chars
    expect(PublicCode.isValid('ABC123XYZ-00')).toBe(false); // 12 chars
    expect(PublicCode.isValid('')).toBe(false);
  });

  it('rejects illegal characters', () => {
    expect(PublicCode.isValid('abc123xyz-0')).toBe(false); // lowercase
    expect(PublicCode.isValid('ABC123XYZ_0')).toBe(false); // underscore
    expect(PublicCode.isValid('ABC 123XYZ0')).toBe(false); // space
  });

  it('rejects non-string values', () => {
    expect(PublicCode.isValid(null)).toBe(false);
    expect(PublicCode.isValid(undefined)).toBe(false);
    expect(PublicCode.isValid(12345678901)).toBe(false);
  });
});
