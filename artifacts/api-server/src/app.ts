import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { apiErrorHandler, apiNotFoundHandler } from "./middlewares/apiErrorMiddleware";
import { mountStaticSite } from "./middlewares/staticSiteMiddleware";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";

const app: Express = express();

// Hostinger (like most Node hosts) puts a reverse proxy in front of the app,
// so the socket address is the proxy's, not the visitor's. Trusting the
// proxy makes req.ip reflect X-Forwarded-For, which the rate limiter below
// needs to avoid treating every visitor as one client. The hop count is
// configurable because trusting more hops than actually exist would let a
// caller spoof their own IP.
const trustProxy = process.env["TRUST_PROXY"] ?? "1";
if (trustProxy !== "false") {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Security headers.
//
// The Content-Security-Policy is opt-in rather than on by default: this app
// loads Clerk, Google Fonts and LiveKit from third-party origins, and a CSP
// that misses one of them fails closed — a blank screen in production with
// only a console message to explain it. Set ENABLE_CSP=true once the policy
// has been validated against a real deployment.
//
// COEP is off for the same reason (it blocks cross-origin resources that
// don't opt in), and CORP is relaxed to cross-origin so static assets can be
// fetched normally.
app.use(
  helmet({
    contentSecurityPolicy: process.env["ENABLE_CSP"] === "true" ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Clerk Frontend API proxy — must be mounted BEFORE body parsers.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// gzip/brotli responses. Mounted after the Clerk proxy so proxied responses
// are passed through untouched, and before the routes so both API JSON and
// the static frontend benefit — the frontend build is ~3.4 MB uncompressed.
app.use(compression());

app.use(cors({ origin: true, credentials: true }));
// SESSION_SECRET is guaranteed present (checked in index.ts)
app.use(cookieParser(process.env["SESSION_SECRET"]));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Liveness check, mounted ahead of Clerk so it answers even when auth is
// misconfigured. An uptime monitor needs to distinguish "the process is down"
// from "the process is up but a key is missing", and a health endpoint that
// depends on auth cannot do that.
app.use("/api", healthRouter);

// Resolve the publishable key from the request host so the same server can
// serve multiple Clerk custom domains; falls back to CLERK_PUBLISHABLE_KEY.
//
// Scoped to /api rather than mounted globally. Clerk's middleware throws when
// CLERK_SECRET_KEY is absent, and mounted globally that throw also hits
// requests for index.html, JS and CSS — so a missing or misconfigured key
// turned every static asset into a 500 and the app could not even render a
// sign-in page to explain itself. Authentication belongs on the API surface;
// serving the frontend shell should not depend on it.
app.use(
  "/api",
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Abuse ceiling for the API.
//
// The limit is deliberately high. A single dashboard page fires 15-25
// requests, and an office behind one NAT shares a public IP, so a tight limit
// would lock out ordinary users long before it stopped anyone abusive. This
// is a backstop against runaway loops and scripted hammering, not a quota.
const rateLimitMax = Number(process.env["RATE_LIMIT_MAX"] ?? 1000);
const rateLimitWindowMs = Number(process.env["RATE_LIMIT_WINDOW_MS"] ?? 60_000);

app.use(
  "/api",
  rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Uptime monitors poll this constantly and must never be throttled.
    skip: (req) => req.path === "/healthz",
    message: { error: "Too many requests — please slow down and try again shortly." },
  }),
);

app.use("/api", router);

// Anything still unmatched under /api is a genuine 404, and must be answered
// as JSON before the SPA fallback below would hand back index.html.
app.use("/api", apiNotFoundHandler);
app.use("/api", apiErrorHandler);

// Serve the built frontend and the SPA history fallback. Mounted last so
// every API route above takes precedence. No-op when no build is present,
// which is the normal case in development.
mountStaticSite(app);

export default app;
