// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { useNotice } from '../../src/hooks/useNotice';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

// Minimal consumer: a button that raises a notice, so the provider's render side of the
// contract is observable from the outside.
function Raiser() {
  const { show } = useNotice();
  return (
    <button type="button" onClick={() => show({ message: 'Welcome, Ada!' })}>
      raise
    </button>
  );
}

// Consumer for the confirm side: raises a delete-style confirm carrying the caller's action.
function ConfirmRaiser({ onConfirm }: { onConfirm: () => void }) {
  const { ask } = useNotice();
  return (
    <button
      type="button"
      onClick={() => ask({ title: 'Delete post?', message: 'Sure?', confirmCaption: 'Confirm delete', onConfirm })}
    >
      raise confirm
    </button>
  );
}

describe('NoticeProvider', () => {
  it('renders no dialog until a notice is shown', () => {
    render(<NoticeProvider><Raiser /></NoticeProvider>);

    expect(document.querySelector('dialog')).toBeNull();
  });

  it('shows the dialog for a raised notice and clears it on Ok', () => {
    render(<NoticeProvider><Raiser /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise' }));
    expect(screen.getByText('Welcome, Ada!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ok' }));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('throws when useNotice is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Raiser />)).toThrow(/NoticeProvider/);
    spy.mockRestore();
  });
});

describe('NoticeProvider confirm dialogs', () => {
  it('shows the confirm dialog for a raised confirm', () => {
    render(<NoticeProvider><ConfirmRaiser onConfirm={vi.fn()} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));

    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
  });

  it('cancel clears the dialog without running the action', () => {
    const onConfirm = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onConfirm={onConfirm} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('confirm runs the action exactly once and clears the dialog', () => {
    const onConfirm = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onConfirm={onConfirm} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
});
