import { describe, expect, it } from 'vitest';

import { isValid } from '../../src/lib/publicCode';

describe('publicCode.isValid', () => {
  it('accepts well-formed 11-character codes', () => {
    expect(isValid('ABC123XYZ-0')).toBe(true);
    expect(isValid('AAAAAAAAAAA')).toBe(true);
    expect(isValid('-----------')).toBe(true);
  });

  it('rejects codes of the wrong length', () => {
    expect(isValid('ABC123XYZ0')).toBe(false); // 10 chars
    expect(isValid('ABC123XYZ-00')).toBe(false); // 12 chars
    expect(isValid('')).toBe(false);
  });

  it('rejects illegal characters', () => {
    expect(isValid('abc123xyz-0')).toBe(false); // lowercase
    expect(isValid('ABC123XYZ_0')).toBe(false); // underscore
    expect(isValid('ABC 123XYZ0')).toBe(false); // space
  });

  it('rejects non-string values', () => {
    expect(isValid(null)).toBe(false);
    expect(isValid(undefined)).toBe(false);
    expect(isValid(12345678901)).toBe(false);
  });
});
