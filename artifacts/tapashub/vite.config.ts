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
        // Let the old service worker keep serving until the user refreshes,
        // avoiding the forced reload caused by skipWaiting/clientsClaim.
        clientsClaim: false,
        skipWaiting: false,
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
    // Keep chunks under ~500 KB uncompressed so the browser can parallelise
    // downloads. Individual page chunks are already split by React.lazy; this
    // splits the shared vendor bundle into focused groups so the dashboard
    // doesn't have to wait for recharts/xlsx/framer-motion.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // xlsx is heavy (≈300 KB) and only used on the Finance page —
          // keep it in its own chunk so every other page avoids loading it.
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx';

          // Recharts + d3 helpers — only loaded on Analytics/Finance pages.
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'vendor-charts';

          // Framer Motion — animation library, not needed on first paint.
          if (id.includes('node_modules/framer-motion')) return 'vendor-motion';

          // Clerk auth SDK — needed before route render, but can be its own chunk
          // so React core finishes parsing before the auth SDK arrives.
          if (id.includes('node_modules/@clerk')) return 'vendor-clerk';

          // Radix UI primitives — large but tree-shakeable at build time;
          // splitting them away from React means the UI shell renders faster.
          if (id.includes('node_modules/@radix-ui')) return 'vendor-radix';

          // Tanstack Query + Wouter — small but shared across every page.
          if (
            id.includes('node_modules/@tanstack') ||
            id.includes('node_modules/wouter')
          ) return 'vendor-query';

          // React core — always needed first, isolated so the browser can
          // cache it independently from everything else.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) return 'vendor-react';

          // LiveKit video/audio — only used on meetings/call-center pages.
          // Split the core client from the React components so each chunk is
          // smaller and can be cached/loaded independently.
          if (id.includes('node_modules/livekit-client')) return 'vendor-livekit-client';
          if (id.includes('node_modules/@livekit')) return 'vendor-livekit';

          // Socket.IO client — only used by chat realtime.
          if (id.includes('node_modules/socket.io-client')) return 'vendor-socket';

          // FullCalendar — only used by planner.
          if (id.includes('node_modules/@fullcalendar')) return 'vendor-calendar';

          // Uppy file upload stack — only used on documents/inventory pages.
          if (id.includes('node_modules/@uppy')) return 'vendor-uppy';

          // Heavy icon/animation libraries that are not needed on every page.
          if (id.includes('node_modules/react-icons')) return 'vendor-icons';
          if (id.includes('node_modules/framer-motion')) return 'vendor-motion';

          // Date/calendar utilities and other page-specific libraries.
          if (id.includes('node_modules/date-fns')) return 'vendor-date';
          if (id.includes('node_modules/react-day-picker')) return 'vendor-date';
          if (id.includes('node_modules/vaul') || id.includes('node_modules/embla-carousel')) return 'vendor-ui';

          // Remaining third-party code into a shared common vendor chunk.
          if (id.includes('node_modules')) return 'vendor-common';
        },
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
