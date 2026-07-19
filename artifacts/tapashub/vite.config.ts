import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// PORT is only needed for the dev/preview server; production builds are
// static-served so the port is irrelevant. Fallback to 0 for build mode.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 0;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH defaults to "/" — correct for production static serving.
const rawBasePath = process.env.BASE_PATH ?? '/';

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
      // Use 'prompt' instead of 'autoUpdate' so a new service worker does not
      // force a page reload the moment it installs. This prevents the reload
      // flashes and initialization errors users see after deployments.
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${basePath}index.html`,
        // Never serve API or auth traffic from the cache.
        navigateFallbackDenylist: [/^\/api/, /\/__clerk/],
        cleanupOutdatedCaches: true,
        // Take over immediately on every new deployment so users never see
        // stale cached assets after an update. Without this, old service workers
        // keep serving the old index.html (with old JS/CSS hashes that no longer
        // exist on the server) until every tab is closed, causing blank screens.
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
    // NOTE: manual vendor chunking was removed. The previous manualChunks
    // config produced circular chunks (vendor-common <-> vendor-react/charts),
    // which crashed the production bundle at load time with
    // "Cannot access 'X' before initialization" — a blank white screen.
    // Rollup's automatic chunking plus the React.lazy route splits keep
    // bundles reasonably sized without cycle risk.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
      },
    },
  },
  server: {
    port: port || undefined,
    strictPort: !!port,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      // Route Socket.IO through the Vite dev server to the API server so the
      // WebSocket upgrade reaches the Socket.IO instance. Replit's path-proxy
      // drops WS upgrades, so the Vite proxy is required for chat in dev.
      // The socket is mounted at /api/socket.io so the same path also works
      // in production, where only /api/* is forwarded to the backend.
      '/api/socket.io': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: port || undefined,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
