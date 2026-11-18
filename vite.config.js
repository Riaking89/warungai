import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the same build works on
// Firebase Hosting, GitHub Pages, or any static host.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
});
