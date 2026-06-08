/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      // Scope coverage to the source actually under test so untested skeleton
      // entry files (main.tsx/App.tsx) do not mask or sink the real number.
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      thresholds: { lines: 90 },
    },
  },
});
