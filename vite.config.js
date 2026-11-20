import { defineConfig } from 'vite';

// Relative asset paths so the build works from any sub-path (e.g. GitHub Pages /TD/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
