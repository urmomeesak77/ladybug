// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeDialog from '../../src/components/NoticeDialog';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

describe('NoticeDialog', () => {
  it('opens as a modal showing the message and an Ok button', () => {
    render(<NoticeDialog message="Saved." onClose={vi.fn()} />);

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ok' })).toBeTruthy();
  });

  it('renders the optional title and a custom button caption', () => {
    render(<NoticeDialog title="Notice" message="Saved." btnCaption="Fine" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Notice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fine' })).toBeTruthy();
  });

  it('reports the button click through onClose', () => {
    const onClose = vi.fn();
    render(<NoticeDialog message="Saved." onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ok' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports Esc (cancel) through onClose instead of swallowing it', () => {
    const onClose = vi.fn();
    render(<NoticeDialog message="Saved." onClose={onClose} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
