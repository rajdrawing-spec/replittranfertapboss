/**
 * Serves the built React frontend from the same Node process as the API.
 *
 * On Replit this was unnecessary: `.replit` sets `router = "application"`,
 * which splits traffic so that only `/api/*` reaches this server and
 * everything else is handled by a separate static host. Hostinger's Node.js
 * hosting gives us a single process on a single port, so this server has to
 * serve the SPA itself — otherwise `/` returns 404 and the app never loads.
 *
 * Two things are needed:
 *   1. Static assets, with cache headers that suit their lifetime.
 *   2. A history fallback, so a deep link like /invoices/123 returns
 *      index.html instead of 404 when the user refreshes the page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type RequestHandler, type Express } from "express";

import { logger } from "../lib/logger";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations for the frontend build, in priority order.
 *
 * The bundled server runs from `artifacts/api-server/dist/index.mjs`, so the
 * sibling frontend build sits two levels up. The `dist/public` candidate
 * covers the common deployment shape where the frontend is copied next to the
 * server bundle instead of keeping the monorepo layout.
 */
function candidateDirs(): string[] {
  const fromEnv = process.env["WEB_DIST"];
  return [
    ...(fromEnv ? [path.resolve(fromEnv)] : []),
    path.resolve(currentDir, "../../tapashub/dist/public"),
    path.resolve(currentDir, "public"),
    path.resolve(process.cwd(), "artifacts/tapashub/dist/public"),
  ];
}

/** First candidate that actually contains an index.html, or null. */
export function resolveWebDist(): string | null {
  for (const dir of candidateDirs()) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

/**
 * True for paths this server must never answer with index.html.
 *
 * `/api` covers the REST routes, the Clerk proxy (mounted at
 * `/api/__clerk`) and the Socket.IO endpoint (`/api/socket.io`), all of
 * which live under the same prefix by design.
 */
function isApiPath(urlPath: string): boolean {
  return urlPath === "/api" || urlPath.startsWith("/api/");
}

/**
 * Mounts static file serving plus the SPA history fallback.
 *
 * Call this *after* the `/api` router is mounted so API routes always win.
 * When no frontend build is present the function is a no-op and logs a
 * warning — that is the normal case in development, where Vite serves the
 * frontend on its own port and proxies `/api` here.
 */
export function mountStaticSite(app: Express): void {
  const webDist = resolveWebDist();

  if (!webDist) {
    logger.warn(
      { searched: candidateDirs() },
      "No frontend build found — serving API only. Run `pnpm --filter @workspace/tapashub run build` before starting in production, or set WEB_DIST.",
    );
    return;
  }

  logger.info({ webDist }, "Serving frontend build");

  // Vite emits content-hashed filenames into /assets, so those are safe to
  // cache forever: a new deployment produces new filenames. Everything else
  // (favicons, manifest, and especially index.html and sw.js) keeps a short
  // or absent cache so a deployment is picked up promptly. Serving a stale
  // index.html is what produces the blank screen after a deploy, because it
  // references JS bundles whose hashed names no longer exist on the server.
  app.use(
    express.static(webDist, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        const relative = path.relative(webDist, filePath);
        const isHashedAsset = relative.startsWith("assets" + path.sep);
        const isServiceWorker = /(^|[\\/])(sw\.js|workbox-[^\\/]+\.js)$/.test(relative);

        if (isHashedAsset) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (isServiceWorker || relative === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      },
    }),
  );

  const indexHtml = path.join(webDist, "index.html");

  // History fallback. Express 5 no longer accepts "*" as a path pattern, so
  // this is mounted as plain middleware that filters by method and path.
  const spaFallback: RequestHandler = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (isApiPath(req.path)) return next();
    // A request that explicitly wants JSON is not a browser navigation, so
    // answering it with an HTML page would only produce a confusing parse
    // error on the client.
    if (!req.accepts("html")) return next();

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  };

  app.use(spaFallback);
}
