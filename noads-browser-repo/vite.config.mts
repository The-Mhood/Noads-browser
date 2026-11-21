import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' is required: the renderer is loaded from file:// by Electron,
// so all asset URLs must be relative, never absolute.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
