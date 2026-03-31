import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Tell Vite its HMR websocket is reachable via the nginx port (80)
    hmr: {
      clientPort: 80,
      protocol: 'ws',
    },
    // Allow requests proxied from nginx (the Docker gateway IP)
    allowedHosts: ['all'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
