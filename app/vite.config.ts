import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The generated pixel assets live in ../assets and are served as-is.
export default defineConfig({
  plugins: [react()],
  publicDir: '../assets',
  base: './',
  test: { environment: 'node' },
} as any);
