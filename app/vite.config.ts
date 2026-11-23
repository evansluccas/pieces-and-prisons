import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The generated pixel assets live in ../assets and are served as-is.
export default defineConfig({
  plugins: [react()],
  publicDir: '../assets',
  base: './',
  // the game server (npm run server) answers /api; in development Vite forwards to it
  server: { proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  test: { environment: 'node' },
} as any);
