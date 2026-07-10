// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '../../src/components/ConfirmDialog';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('opens as a modal showing title, message, Cancel and the confirm caption', () => {
    render(
      <ConfirmDialog
        title="Delete post?"
        message="Sure?"
        confirmCaption="Confirm delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
  });

  it('defaults the confirm caption to Confirm and the title to none', () => {
    render(<ConfirmDialog message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('reports the confirm click through onConfirm only', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports the Cancel click through onCancel only', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reports Esc (the dialog cancel event) through onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
