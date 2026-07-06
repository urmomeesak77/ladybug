// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthField from '../../src/components/AuthField';

afterEach(cleanup);

function renderField(error?: string, onChange = vi.fn(), onBlur = vi.fn()) {
  render(
    <AuthField
      id="email"
      label="E-mail"
      type="email"
      value="a@b.co"
      autoComplete="email"
      error={error}
      onChange={onChange}
      onBlur={onBlur}
    />,
  );
  return { onChange, onBlur };
}

describe('AuthField', () => {
  it('associates the label with the input', () => {
    renderField();

    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveProperty('type', 'email');
    expect(input).toHaveProperty('value', 'a@b.co');
  });

  it('reports typed values through onChange', () => {
    const { onChange } = renderField();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'new@b.co' } });

    expect(onChange).toHaveBeenCalledWith('new@b.co');
  });

  it('exposes an error as an alert tied to the input via aria-describedby', () => {
    renderField('E-mail is required.');

    const input = screen.getByLabelText('E-mail');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('E-mail is required.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('omits the error affordances when there is no error', () => {
    renderField();

    const input = screen.getByLabelText('E-mail');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('hides the label visually and mirrors it as the placeholder', () => {
    renderField();

    const input = screen.getByLabelText('E-mail');
    expect(input.getAttribute('placeholder')).toBe('E-mail');
    expect(document.querySelector('label.sr-only')?.textContent).toBe('E-mail');
  });

  it('reports blur through onBlur', () => {
    const { onBlur } = renderField();

    fireEvent.blur(screen.getByLabelText('E-mail'));

    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
