/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    include: ["unittests/**/*.test.ts", "unittests/**/*.test.tsx"],
    globals: true,
    environment: 'jsdom',
    setupFiles: 'unittests/setup.ts',
    css: true,
    esbuild: false,
  },
})
