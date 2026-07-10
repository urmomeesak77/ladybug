import { createContext, useContext } from 'react';

export type Notice = { message: string; title?: string };

// One destructive choice in a confirm dialog. `strong` marks the harsher outcome (e.g. an
// irreversible delete) for heavier visual weight; the caption itself must still carry the
// meaning — color/weight is never the sole signal (Principle IV).
export type ConfirmAction = {
  caption: string;
  onChoose: () => void;
  strong?: boolean;
};

// A pending confirmation: the message to show and the destructive choices on offer.
// Cancel (or Esc) is always available and drops the confirm with nothing run.
export type Confirm = {
  message: string;
  title?: string;
  actions: ConfirmAction[];
};

export type NoticeContextValue = {
  notice: Notice | null;
  confirm: Confirm | null;
  show: (notice: Notice) => void;
  ask: (confirm: Confirm) => void;
  clear: () => void;
};

// The provider (components/NoticeProvider) supplies the value; consumers read it via the
// useNotice hook. Context + hook live here (no component) so the provider file can satisfy
// react-refresh's component-only-export rule — same split as AuthContext/useAuth.
export const NoticeContext = createContext<NoticeContextValue | null>(null);

export function useNotice(): NoticeContextValue {
  const context = useContext(NoticeContext);
  if (!context) {
    throw new Error('useNotice must be used within a NoticeProvider');
  }
  return context;
}
