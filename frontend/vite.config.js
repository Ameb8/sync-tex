import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const parseList = (value) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      try {
        return new URL(item).hostname;
      } catch {
        return item;
      }
    });

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = parseList(env.DEV_ALLOWED_HOSTS);
  const hmrHost = env.DEV_HMR_HOST?.trim();

  return {
    plugins: [
      react(),
    ],
    server: {
      host: env.DEV_SERVER_HOST || '0.0.0.0',
      port: parseInteger(env.DEV_SERVER_PORT, 5173),
      strictPort: true,
      // The nginx dev config proxies browser traffic to Vite on the host.
      hmr: {
        clientPort: parseInteger(env.DEV_HMR_CLIENT_PORT, 80),
        protocol: env.DEV_HMR_PROTOCOL || 'ws',
        ...(hmrHost ? { host: hmrHost } : {}),
      },
      ...(allowedHosts?.length ? { allowedHosts } : {}),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
              return 'vendor-monaco';
            }

            if (
              id.includes('/yjs/') ||
              id.includes('/y-monaco/') ||
              id.includes('/y-protocols/') ||
              id.includes('/y-websocket/')
            ) {
              return 'vendor-yjs';
            }

            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router-dom/')
            ) {
              return 'vendor-react';
            }

            return undefined;
          },
        },
      },
    },
  };
});
