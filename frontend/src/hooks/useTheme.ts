import { useEffect } from 'react';

import { prefersDark, watchScheme } from '../lib/theme';

// Reflect the OS color scheme on the document via the CSS `color-scheme` property so native
// UI (form controls, scrollbars, the canvas background) matches our themed CSS, and keep it
// in sync if the OS preference changes at runtime (Principle IV / research D8). The color
// tokens themselves switch declaratively via the prefers-color-scheme media query in CSS.
export function useTheme(): void {
  useEffect(() => {
    const apply = (isDark: boolean) => {
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };
    apply(prefersDark());
    return watchScheme(apply);
  }, []);
}
