import { useEffect, useRef } from 'react';

import type { ConfirmAction } from '../hooks/useNotice';

// One destructive choice: danger-styled, heavier when marked strong. A named component
// (not an inline closure in the map) keeps the click handler a plain function.
function ActionButton({ action, onChoose }: { action: ConfirmAction; onChoose: (action: ConfirmAction) => void }) {
  function handleClick(): void {
    onChoose(action);
  }

  const className = action.strong
    ? 'notice-dialog__danger notice-dialog__danger--strong'
    : 'notice-dialog__danger';

  return (
    <button type="button" className={className} onClick={handleClick}>
      {action.caption}
    </button>
  );
}

// Native <dialog> confirm modal — the multi-choice sibling of NoticeDialog. Cancel always
// leads the row; Esc (the dialog's cancel event) reports through onCancel like the Cancel
// button, so keyboard users can always back out (Principle IV). What each choice *does* is
// entirely the caller's business.
function ConfirmDialog({ message, title, actions, onChoose, onCancel }: {
  message: string;
  title?: string;
  actions: ConfirmAction[];
  onChoose: (action: ConfirmAction) => void;
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
        {actions.map((action) => (
          <ActionButton key={action.caption} action={action} onChoose={onChoose} />
        ))}
      </div>
    </dialog>
  );
}

export default ConfirmDialog;
