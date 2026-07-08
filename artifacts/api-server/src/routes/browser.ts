/**
 * Browser workspace REST routes.
 *
 * GET  /api/browser/stream        — SSE screenshot stream (long-lived GET)
 * POST /api/browser/input         — browser input events (click, key, etc.)
 * GET  /api/browser/sessions      — list active sessions (super admin only)
 *
 * The SSE stream replaces the previous WebSocket approach.  SSE is plain HTTP
 * so it flows through Replit's dev proxy and any deployment proxy without
 * requiring special WebSocket-upgrade support.
 *
 * Auth: requireAuth middleware is applied at the router level (routes/index.ts).
 * canAccessCompany() guards cross-company access within each handler.
 */

import { Router } from 'express';
import { handleSseStream, handleBrowserInput } from '../browser-sessions/sse-handler.js';
import { browserSessionManager } from '../browser-sessions/manager.js';

const router = Router();

// ── SSE screenshot stream ─────────────────────────────────────────────────────
router.get('/browser/stream', (req, res) => {
  void handleSseStream(req, res);
});

// ── Browser input events ──────────────────────────────────────────────────────
router.post('/browser/input', (req, res) => {
  void handleBrowserInput(req, res);
});

// ── Active sessions (super admin only) ───────────────────────────────────────
router.get('/browser/sessions', (req, res) => {
  try {
    const localUser = (req as any).localUser;
    if (localUser?.role !== 'super_admin') {
      res.status(403).json({ error: 'Super admin only' });
      return;
    }
    res.json(browserSessionManager.getActiveSessions());
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: 'Failed to list browser sessions' });
  }
});

export default router;
