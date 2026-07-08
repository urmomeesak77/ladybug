import type { ReactNode } from 'react';

// Action button with an in-flight state shared by every form that talks to the API.
// While busy it disables itself, announces aria-busy, and shows a spinner next to the
// unchanged label — the wait is signalled by shape and motion, never color alone
// (Principle IV). The spinner is aria-hidden so the label keeps naming the button.
function BusyButton({ busy, children, className, disabled, onClick, type = 'button' }: {
  busy: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className={className ? `busy-button ${className}` : 'busy-button'}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <span className="busy-button__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export default BusyButton;
