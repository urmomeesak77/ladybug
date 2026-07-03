/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Windows host + Docker bind mount: inotify events don't cross into the Linux
  // container, so the watcher must poll for HMR to detect edits (dev-only cost).
  server: {
    watch: { usePolling: true },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      // ALL source is coverage-gated (Principle VII), not just lib/. The only
      // exclusion is main.tsx: it mounts <App/> at import time, so importing it
      // in a test would boot the real app instead of exercising a unit.
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
      thresholds: { lines: 90 },
    },
  },
});
