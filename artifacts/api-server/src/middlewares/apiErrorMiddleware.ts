/**
 * Terminal handlers for the `/api` surface.
 *
 * Without these, an unmatched API route falls through to the SPA fallback and
 * returns index.html — so a typo'd endpoint reaches the client as a chunk of
 * HTML that fails to JSON.parse, which is a confusing way to learn about a
 * 404. An unhandled throw likewise reaches Express's default handler, which
 * renders an HTML error page and, outside production, includes the stack
 * trace in the response body.
 *
 * Both handlers keep the response shape consistent with the rest of the API:
 * a JSON object with an `error` message.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";

import { logger } from "../lib/logger";

/** 404 for anything under /api that no router claimed. */
export const apiNotFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl.split("?")[0],
  });
};

/**
 * Converts a thrown error into a JSON response.
 *
 * The message is only echoed back for client errors (4xx), which are the ones
 * a caller can act on. A 5xx means something broke inside the server, so the
 * detail goes to the logs and the client gets a generic message rather than
 * an accidental leak of internal state.
 */
export const apiErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status =
    typeof err?.status === "number"
      ? err.status
      : typeof err?.statusCode === "number"
        ? err.statusCode
        : 500;

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl }, "Unhandled API error");
  }

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : (err?.message ?? "Request failed"),
  });
};
