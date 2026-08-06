import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_HIDE_MS = 3000;

// Touch devices have no hover event, so the video control overlay (MemeMedia's VideoMedia)
// needs a tap-driven reveal instead: a tap toggles the overlay, and showing it starts a timer
// that hides it again after a few seconds of inactivity. Desktop hover and keyboard focus are
// handled in CSS (:hover / :focus-within) — this hook only covers the tap path.
export function useVideoTapToggle(): {
  tapVisible: boolean;
  toggleTapVisible: () => void;
  keepTapVisible: () => void;
} {
  const [tapVisible, setTapVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); }
    };
  }, []);

  const toggleTapVisible = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setTapVisible((value) => {
      const next = !value;
      if (next) {
        timeoutRef.current = setTimeout(() => setTapVisible(false), AUTO_HIDE_MS);
      }
      return next;
    });
  }, []);

  // Re-arms the auto-hide timer without toggling visibility, so a control (e.g. the scrub
  // bar) being actively dragged doesn't have the overlay fade out from under it. A no-op
  // while hidden — this only extends an existing reveal, it never triggers one.
  const keepTapVisible = useCallback(() => {
    setTapVisible((value) => {
      if (!value) {
        return value;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setTapVisible(false), AUTO_HIDE_MS);
      return value;
    });
  }, []);

  return { tapVisible, toggleTapVisible, keepTapVisible };
}
