// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '../../src/components/ConfirmDialog';
import type { ConfirmAction } from '../../src/hooks/useNotice';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

describe('ConfirmDialog', () => {
  const softDelete: ConfirmAction = { caption: 'Soft delete', onChoose: () => {} };
  const hardDelete: ConfirmAction = { caption: 'Delete permanently', onChoose: () => {}, strong: true };

  it('opens as a modal showing title, message, Cancel and one button per action', () => {
    render(
      <ConfirmDialog
        title="Delete post?"
        message="Sure?"
        actions={[softDelete, hardDelete]}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Soft delete', 'Delete permanently']);
  });

  it('omits the heading when no title is given', () => {
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('marks a strong action with the heavier danger style', () => {
    render(<ConfirmDialog message="Sure?" actions={[softDelete, hardDelete]} onChoose={vi.fn()} onCancel={vi.fn()} />);

    const soft = screen.getByRole('button', { name: 'Soft delete' });
    const hard = screen.getByRole('button', { name: 'Delete permanently' });
    expect(soft.className).toBe('notice-dialog__danger');
    expect(hard.className).toBe('notice-dialog__danger notice-dialog__danger--strong');
  });

  it('reports a clicked action through onChoose with that action', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog message="Sure?" actions={[softDelete, hardDelete]} onChoose={onChoose} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(hardDelete);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports the Cancel click through onCancel only', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={onChoose} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('reports Esc (the dialog cancel event) through onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={vi.fn()} onCancel={onCancel} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
