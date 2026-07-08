// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BusyButton from '../../src/components/BusyButton';

afterEach(cleanup);

describe('BusyButton', () => {
  it('renders an idle button without spinner or aria-busy', () => {
    render(<BusyButton type="submit" busy={false}>Register</BusyButton>);

    const button = screen.getByRole('button', { name: 'Register' });
    expect(button.getAttribute('type')).toBe('submit');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.busy-button__spinner')).toBeNull();
  });

  it('disables itself, sets aria-busy, and shows the spinner while busy', () => {
    render(<BusyButton type="submit" busy>Register</BusyButton>);

    const button = screen.getByRole('button', { name: 'Register' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    const spinner = button.querySelector('.busy-button__spinner');
    expect(spinner).not.toBeNull();
    // Decorative: the label alone must keep naming the button.
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stays disabled when idle but externally disabled (validation gate)', () => {
    render(<BusyButton type="submit" busy={false} disabled>Register</BusyButton>);

    const button = screen.getByRole('button', { name: 'Register' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector('.busy-button__spinner')).toBeNull();
  });

  it('merges the busy-button class with a caller class and forwards clicks', () => {
    const onClick = vi.fn();
    render(
      <BusyButton busy={false} className="account__resend" onClick={onClick}>
        Resend verification e-mail
      </BusyButton>,
    );

    const button = screen.getByRole('button', { name: 'Resend verification e-mail' });
    expect(button.className).toBe('busy-button account__resend');
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
