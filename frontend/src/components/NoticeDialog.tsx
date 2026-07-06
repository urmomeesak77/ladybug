import { useEffect, useRef } from 'react';

// Native <dialog> notice modal, ported from the prototype. Deviation: Esc (the dialog's
// cancel event) reports through onClose instead of being swallowed, so keyboard users can
// always dismiss it (Principle IV).
function NoticeDialog({ message, title, btnCaption = 'Ok', onClose }: {
  message: string;
  title?: string;
  btnCaption?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog className="notice-dialog" ref={dialogRef} onCancel={onClose}>
      {title ? <h2>{title}</h2> : null}
      <p>{message}</p>
      <div className="notice-dialog__buttons">
        <button type="button" onClick={onClose}>{btnCaption}</button>
      </div>
    </dialog>
  );
}

export default NoticeDialog;
