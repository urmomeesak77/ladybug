// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthForm } from '../../src/hooks/useAuthForm';
import type { FieldErrors } from '../../src/lib/authApi';

function validate(values: { email: string }, touched?: Set<string>): FieldErrors {
  const check = touched === undefined || touched.has('email');
  return check && values.email === '' ? { email: ['Required.'] } : {};
}

describe('useAuthForm', () => {
  it('validates touched fields on blur and clears a server error on change', () => {
    const { result } = renderHook(() => useAuthForm({ email: '' }, validate));

    act(() => result.current.handleBlur('email'));
    expect(result.current.errors.email).toEqual(['Required.']);

    act(() => result.current.setServerErrors({ email: ['Taken.'] }));
    act(() => result.current.handleChange('email', 'a@b.c'));
    expect(result.current.errors.email).toBeUndefined();
  });

  it('startSubmit touches everything and reports validity', () => {
    const { result } = renderHook(() => useAuthForm({ email: '' }, validate));

    let valid = true;
    act(() => { valid = result.current.startSubmit(); });
    expect(valid).toBe(false);
    expect(result.current.hasErrors).toBe(true);

    act(() => result.current.handleChange('email', 'a@b.c'));
    act(() => { valid = result.current.startSubmit(); });
    expect(valid).toBe(true);
  });
});
