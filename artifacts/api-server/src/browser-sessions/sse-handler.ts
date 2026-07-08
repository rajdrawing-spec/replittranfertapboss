/**
 * Browser Workspace SSE Handler
 *
 * Replaces the WebSocket approach with Server-Sent Events (SSE) for the
 * screenshot stream and regular HTTP POST for input events.
 *
 * Why SSE instead of WebSocket:
 *   Replit's dev-mode path proxy routes /api/* HTTP requests to the API
 *   server correctly, but silently drops WebSocket upgrade requests.  SSE
 *   is plain HTTP (a long-lived GET with Content-Type: text/event-stream)
 *   so it flows through any proxy without special config, including Replit.
 *
 * Stream protocol (server → client, text/event-stream):
 *   data: {"type":"status","state":"loading"}         — session starting
 *   data: {"type":"status","state":"ready","url":"…"} — browser ready
 *   data: {"type":"frame","data":"<base64_jpeg>"}      — screenshot frame
 *   data: {"type":"url","url":"…"}                    — URL change
 *   data: {"type":"error","message":"…"}              — fatal error
 *   : ping                                             — keepalive comment
 *
 * Input protocol (client → server, POST /api/browser/input):
 *   body: { companyId, platform, event: { type, …params } }
 */

import type { Request, Response } from 'express';
import { browserSessionManager } from './manager.js';
import { getCatalogPlatform } from '../lib/integration-catalog.js';
import { canAccessCompany } from '../lib/company-scope.js';

// ── SSE stream endpoint ───────────────────────────────────────────────────────

export async function handleSseStream(req: Request, res: Response): Promise<void> {
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

  // ── SSE headers ─────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable buffering in nginx / Replit's edge proxy so events arrive immediately.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: object): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendComment = (comment: string): void => {
    if (res.writableEnded) return;
    res.write(`: ${comment}\n\n`);
  };

  // Keepalive ping every 15 s — prevents idle proxies from closing the stream.
  const pingInterval = setInterval(() => sendComment('ping'), 15_000);

  let screenshotLoop: NodeJS.Timeout | null = null;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  const stop = (): void => {
    if (screenshotLoop) { clearInterval(screenshotLoop); screenshotLoop = null; }
    clearInterval(pingInterval);
    if (!res.writableEnded) res.end();
  };

  // Clean up when the client disconnects (browser tab closed, Retry clicked, etc.).
  req.on('close', stop);

  sendEvent({ type: 'status', state: 'loading' });

  // ── Acquire (or resume) browser session ─────────────────────────────────
  let page: import('playwright-core').Page;
  try {
    const result = await browserSessionManager.getOrCreatePage(companyId, platformKey);
    page = result.page;

    // Signal the client that the browser is up — frame stream starts momentarily.
    sendEvent({ type: 'status', state: 'ready', url: page.url() });

    // For new pages, navigate in background — don't block the frame stream.
    if (result.isNew) {
      void page.goto(catalogEntry.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      }).catch(() => { /* non-fatal — page may still partially load */ });
    }
  } catch (err) {
    sendEvent({ type: 'error', message: `Failed to launch browser: ${(err as Error).message}` });
    stop();
    return;
  }

  // ── Screenshot loop: ~5 fps ─────────────────────────────────────────────
  // inFlight prevents screenshot calls from piling up under CPU load.
  // Resilience: up to MAX_CONSECUTIVE_ERRORS consecutive failures before
  // terminating — this survives transient errors during page.reload().
  let lastUrl = '';
  let inFlight = false;

  screenshotLoop = setInterval(async () => {
    if (res.writableEnded || page.isClosed()) { stop(); return; }
    if (inFlight) return;
    inFlight = true;
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
      consecutiveErrors = 0;
      if (!res.writableEnded) {
        // Send frame as base64 in a data event — pure text, works through any proxy.
        res.write(`data: ${JSON.stringify({ type: 'frame', data: shot.toString('base64') })}\n\n`);
      }
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        sendEvent({ type: 'url', url: currentUrl });
      }
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        sendEvent({ type: 'error', message: `Browser session lost: ${(err as Error).message}` });
        stop();
      }
      // else: transient error (mid-navigation) — keep looping
    } finally {
      inFlight = false;
    }
  }, 200);
}

// ── Input event endpoint ─────────────────────────────────────────────────────

export async function handleBrowserInput(req: Request, res: Response): Promise<void> {
  const companyId = parseInt(String(req.body?.companyId ?? ''), 10);
  const platformKey = String(req.body?.platform ?? '').trim();
  const event = req.body?.event as { type: string; [key: string]: unknown } | undefined;

  if (!event?.type) {
    res.status(400).json({ error: 'event.type is required' });
    return;
  }

  if (!canAccessCompany(req, companyId)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const session = browserSessionManager.getExistingPage(companyId, platformKey);
  if (!session) {
    // Return 200 (not 404) — the session may have been cleaned up; the client
    // will notice when the SSE stream ends and show the reconnect prompt.
    res.json({ ok: false, reason: 'no_session' });
    return;
  }

  const { page, viewport } = session;
  if (page.isClosed()) {
    res.json({ ok: false, reason: 'page_closed' });
    return;
  }

  const vw = viewport.width;
  const vh = viewport.height;
  const x = typeof event.x === 'number' ? event.x : 0;
  const y = typeof event.y === 'number' ? event.y : 0;

  try {
    switch (event.type) {
      case 'click':
        await page.mouse.click(x * vw, y * vh, {
          button: (event.button as 'left' | 'right' | 'middle' | undefined) ?? 'left',
        });
        break;
      case 'dblclick':
        await page.mouse.dblclick(x * vw, y * vh);
        break;
      case 'rightclick':
        await page.mouse.click(x * vw, y * vh, { button: 'right' });
        break;
      case 'mousemove':
        await page.mouse.move(x * vw, y * vh);
        break;
      case 'wheel':
        await page.mouse.move(x * vw, y * vh);
        await page.mouse.wheel(
          typeof event.deltaX === 'number' ? event.deltaX : 0,
          typeof event.deltaY === 'number' ? event.deltaY : 0,
        );
        break;
      case 'type':
        if (typeof event.text === 'string') await page.keyboard.type(event.text);
        break;
      case 'keypress':
        if (typeof event.key === 'string') await page.keyboard.press(event.key);
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded' });
        break;
      case 'navigate': {
        let url = typeof event.url === 'string' ? event.url.trim() : '';
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        }
        break;
      }
      case 'resize': {
        const width = typeof event.width === 'number' ? event.width : 1280;
        const height = typeof event.height === 'number' ? event.height : 800;
        browserSessionManager.updateViewport(companyId, platformKey, { width, height });
        await page.setViewportSize({ width, height });
        break;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    // Input errors are non-fatal — page may be mid-navigation.
    res.json({ ok: false, error: (err as Error).message });
  }
}
