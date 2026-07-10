import { useEffect, useRef } from 'react';

// Native <dialog> confirm modal — the two-button sibling of NoticeDialog. Esc (the dialog's
// cancel event) reports through onCancel like the Cancel button, so keyboard users can always
// back out (Principle IV). What confirming *does* is entirely the caller's business.
function ConfirmDialog({ message, title, confirmCaption = 'Confirm', onConfirm, onCancel }: {
  message: string;
  title?: string;
  confirmCaption?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog className="notice-dialog" ref={dialogRef} onCancel={onCancel}>
      {title ? <h2>{title}</h2> : null}
      <p>{message}</p>
      <div className="notice-dialog__buttons">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="notice-dialog__danger" onClick={onConfirm}>{confirmCaption}</button>
      </div>
    </dialog>
  );
}

export default ConfirmDialog;
