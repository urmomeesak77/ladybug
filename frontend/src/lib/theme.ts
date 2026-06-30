// Read and observe the OS color-scheme preference (Principle IV / research D8). A thin,
// testable wrapper around matchMedia so the rest of the app never touches the query string.
const DARK_QUERY = '(prefers-color-scheme: dark)';

export class Theme {
  // Whether the OS currently prefers a dark color scheme.
  static prefersDark(): boolean {
    return window.matchMedia(DARK_QUERY).matches;
  }

  // Subscribe to OS scheme changes; `cb` receives the new value each time it flips. Returns
  // an unsubscribe so callers (the useTheme effect) can clean up on unmount.
  static watchScheme(cb: (isDark: boolean) => void): () => void {
    const query = window.matchMedia(DARK_QUERY);
    const handler = (event: MediaQueryListEvent) => cb(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
}
