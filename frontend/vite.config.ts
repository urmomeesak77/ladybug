/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Windows host + Docker bind mount: inotify events don't cross into the Linux
  // container, so the watcher must poll for HMR to detect edits (dev-only cost).
  // Chokidar's default 100 ms poll stats every file 10x/s over the bind mount,
  // pinning a CPU core; 1 s keeps HMR usable at a fraction of the cost.
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
      binaryInterval: 1500,
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Date output renders in the runtime's local zone (PostDate uses local getters, by
    // design), so a '...Z' fixture would read differently on a UTC+3 dev machine and the
    // UTC CI runner. This pin is a safety net for that, NOT a guarantee to lean on: setting
    // TZ inside a worker thread does not always reset Node's timezone cache (observed
    // failing once here, not reproducible in 10 further runs). Timestamp assertions must
    // therefore use ZONE-LESS ISO date-times, which parse as local and hold in any zone.
    env: { TZ: 'UTC' },
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
