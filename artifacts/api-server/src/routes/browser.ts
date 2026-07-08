/**
 * Browser workspace REST routes.
 *
 * GET /api/browser/token
 *   Issues a short-lived (30 s) one-time WebSocket auth token.
 *   The platform URL is resolved from the trusted integration catalog
 *   server-side — the client never supplies an arbitrary navigation target
 *   (prevents SSRF to internal network endpoints reachable from the server).
 *
 * GET /api/browser/sessions   (super admin only)
 *   Lists all active server-side browser sessions.
 */

import { Router } from 'express';
import { canAccessCompany } from '../lib/company-scope.js';
import { issueWsToken } from '../browser-sessions/ws-handler.js';
import { browserSessionManager } from '../browser-sessions/manager.js';
import { getCatalogPlatform } from '../lib/integration-catalog.js';

const router = Router();

router.get('/browser/token', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId ?? ''), 10);
    const platformKey = String(req.query.platform ?? '').trim();

    if (Number.isNaN(companyId) || companyId <= 0) {
      res.status(400).json({ error: 'companyId is required' });
      return;
    }
    if (!platformKey) {
      res.status(400).json({ error: 'platform is required' });
      return;
    }

    // Resolve the URL from the trusted catalog — never use client-supplied URLs.
    const catalogEntry = getCatalogPlatform(platformKey);
    if (!catalogEntry) {
      res.status(400).json({ error: `Unknown platform: ${platformKey}` });
      return;
    }
    if (!catalogEntry.browserWorkspace) {
      res.status(400).json({ error: `Platform "${platformKey}" does not support browser workspace` });
      return;
    }

    if (!canAccessCompany(req, companyId)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const token = issueWsToken({
      companyId,
      userId: (req as any).userId as number,
      platform: platformKey,
      // URL is trusted catalog data, not user input.
      platformUrl: catalogEntry.url,
    });

    res.json({ token });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: 'Failed to issue browser token' });
  }
});

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
