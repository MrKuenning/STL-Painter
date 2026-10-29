import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    emptyOutDir: false,
  },
});

