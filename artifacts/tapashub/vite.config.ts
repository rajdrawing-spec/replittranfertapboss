import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const rawBasePath = process.env.BASE_PATH;

if (!rawBasePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Normalize to a guaranteed leading + trailing slash so the PWA service worker's
// navigateFallback and manifest scope are always valid, regardless of how the
// env var is provided ("/", "/tapashub", or "/tapashub/"). The root case must
// stay "/" — "//" is a protocol-relative URL that vite rejects.
const stripped = rawBasePath.replace(/^\/+|\/+$/g, '');
const basePath = stripped ? `/${stripped}/` : '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    // Offline-first service worker: precache the app shell + static assets so
    // repeat loads are instant on slow/flaky connections, and the app is
    // installable on mobile home screens. Disabled in dev to avoid caching
    // headaches; never intercepts /api (would risk serving stale tenant data).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${basePath}index.html`,
        // Never serve API or auth traffic from the cache.
        navigateFallbackDenylist: [/^\/api/, /\/__clerk/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TAPBOSS — Business Operating System',
        short_name: 'TAPBOSS',
        description: 'TapasHub Business Operating System',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0b0b0f',
        theme_color: '#0b0b0f',
        icons: [
          { src: 'favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon-32.png', sizes: '32x32', type: 'image/png' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
