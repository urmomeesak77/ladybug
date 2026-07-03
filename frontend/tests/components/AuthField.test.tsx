// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthField from '../../src/components/AuthField';

afterEach(cleanup);

function renderField(error?: string, onChange = vi.fn()) {
  render(
    <AuthField
      id="email"
      label="Email"
      type="email"
      value="a@b.co"
      autoComplete="email"
      error={error}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('AuthField', () => {
  it('associates the label with the input', () => {
    renderField();

    const input = screen.getByLabelText('Email');
    expect(input).toHaveProperty('type', 'email');
    expect(input).toHaveProperty('value', 'a@b.co');
  });

  it('reports typed values through onChange', () => {
    const onChange = renderField();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@b.co' } });

    expect(onChange).toHaveBeenCalledWith('new@b.co');
  });

  it('exposes an error as an alert tied to the input via aria-describedby', () => {
    renderField('Email is required.');

    const input = screen.getByLabelText('Email');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Email is required.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('omits the error affordances when there is no error', () => {
    renderField();

    const input = screen.getByLabelText('Email');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
