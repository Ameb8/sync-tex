import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/vscode-oniguruma/release/onig.wasm',
          dest: 'assets',
        },
        {
          src: 'src/monaco/grammars/latex.tmLanguage.json',
          dest: 'assets/grammars',
        },
      ],
    }),
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
