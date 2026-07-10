import { createContext, useContext } from 'react';

export type Notice = { message: string; title?: string };

// A pending confirmation: the message/captions to show and the action to run only when the
// user confirms. Cancel (or Esc) drops it unrun.
export type Confirm = {
  message: string;
  title?: string;
  confirmCaption?: string;
  onConfirm: () => void;
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
