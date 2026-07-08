/**
 * Browser Workspace WebSocket Handler
 *
 * Authentication flow (prevents unauthenticated WS upgrades):
 *   1. Client calls REST GET /api/browser/token (goes through requireAuth).
 *   2. Server issues a 32-byte random token with 30 s TTL.
 *   3. Client connects to /api/browser/ws?token=<TOKEN>.
 *   4. Upgrade handler verifies + consumes the token (one-time use).
 *
 * Once connected the server streams JPEG screenshot frames as binary WebSocket
 * messages at ~5 fps.  The client sends JSON input events back.
 *
 * Message protocol
 * ─────────────────
 * Server → Client (binary):  JPEG screenshot frame
 * Server → Client (text):    JSON status/url/error messages
 * Client → Server (text):    JSON input events (see ClientMessage below)
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { randomBytes } from 'crypto';
import { browserSessionManager } from './manager.js';

// ── Token store ──────────────────────────────────────────────────────────────

interface WsTokenData {
  companyId: number;
  userId: number;
  platform: string;
  platformUrl: string;
  expires: number;
}

const pendingTokens = new Map<string, WsTokenData>();

// Sweep expired tokens every minute.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingTokens) {
    if (v.expires < now) pendingTokens.delete(k);
  }
}, 60_000);

export function issueWsToken(
  data: Omit<WsTokenData, 'expires'>,
): string {
  const token = randomBytes(32).toString('hex');
  // 90 s TTL — Playwright cold-start can take 10–30 s before the client
  // even opens the WS, so 30 s was too short and caused race-condition 401s.
  pendingTokens.set(token, { ...data, expires: Date.now() + 90_000 });
  return token;
}

// ── Server setup ─────────────────────────────────────────────────────────────

export function setupBrowserWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== '/api/browser/ws') return;

    const urlObj = new URL(req.url!, 'http://localhost');
    const token = urlObj.searchParams.get('token') ?? '';
    const tokenData = pendingTokens.get(token);

    if (!tokenData || tokenData.expires < Date.now()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    // One-time use — consume immediately.
    pendingTokens.delete(token);

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleSession(ws, tokenData);
    });
  });
}

// ── Session handler ──────────────────────────────────────────────────────────

type ClientMessage =
  | { type: 'click'; x: number; y: number; button?: string }
  | { type: 'dblclick'; x: number; y: number }
  | { type: 'rightclick'; x: number; y: number }
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'type'; text: string }
  | { type: 'keypress'; key: string }
  | { type: 'reload' }
  | { type: 'navigate'; url: string }
  | { type: 'resize'; width: number; height: number };

async function handleSession(ws: WebSocket, token: WsTokenData): Promise<void> {
  const { companyId, platform, platformUrl } = token;
  const viewport = { width: 1280, height: 800 };
  let screenshotLoop: NodeJS.Timeout | null = null;
  // Keepalive ping every 20 s — prevents idle proxies from dropping the connection.
  const pingLoop = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 20_000);

  const sendJson = (data: object): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  sendJson({ type: 'status', state: 'loading' });

  let page: Awaited<ReturnType<typeof browserSessionManager.getOrCreatePage>>;
  try {
    page = await browserSessionManager.getOrCreatePage(
      companyId,
      platform,
      platformUrl,
      viewport,
    );
    sendJson({ type: 'status', state: 'ready', url: page.url() });
  } catch (err) {
    sendJson({
      type: 'error',
      message: `Failed to launch browser: ${(err as Error).message}`,
    });
    ws.close();
    return;
  }

  // ── Screenshot loop: ~5 fps ──────────────────────────────────────────────
  // inFlight prevents queued screenshot calls from piling up when captures
  // are slow (e.g. heavy page, CPU saturation) — we skip a tick instead.
  let lastUrl = '';
  let inFlight = false;

  screenshotLoop = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN || page.isClosed()) {
      if (screenshotLoop) {
        clearInterval(screenshotLoop);
        screenshotLoop = null;
      }
      return;
    }
    if (inFlight) return; // drop frame rather than queue up work
    inFlight = true;
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
      if (ws.readyState === WebSocket.OPEN) ws.send(shot);

      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        sendJson({ type: 'url', url: currentUrl });
      }
    } catch (err) {
      if (screenshotLoop) {
        clearInterval(screenshotLoop);
        screenshotLoop = null;
      }
      // Emit terminal error so the client can surface a reconnect prompt.
      sendJson({
        type: 'error',
        message: `Browser session lost: ${(err as Error).message}`,
      });
    } finally {
      inFlight = false;
    }
  }, 200);

  // ── Input event handler ──────────────────────────────────────────────────
  ws.on('message', async (data) => {
    if (page.isClosed()) return;
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      const vw = viewport.width;
      const vh = viewport.height;

      switch (msg.type) {
        case 'click':
          await page.mouse.click(
            msg.x * vw,
            msg.y * vh,
            { button: (msg.button as 'left' | 'right' | 'middle') ?? 'left' },
          );
          break;
        case 'dblclick':
          await page.mouse.dblclick(msg.x * vw, msg.y * vh);
          break;
        case 'rightclick':
          await page.mouse.click(msg.x * vw, msg.y * vh, { button: 'right' });
          break;
        case 'mousemove':
          await page.mouse.move(msg.x * vw, msg.y * vh);
          break;
        case 'wheel':
          await page.mouse.move(msg.x * vw, msg.y * vh);
          await page.mouse.wheel(msg.deltaX, msg.deltaY);
          break;
        case 'type':
          await page.keyboard.type(msg.text);
          break;
        case 'keypress':
          await page.keyboard.press(msg.key);
          break;
        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded' });
          break;
        case 'navigate': {
          let url = msg.url.trim();
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });
          break;
        }
        case 'resize':
          viewport.width = msg.width;
          viewport.height = msg.height;
          await page.setViewportSize({ width: msg.width, height: msg.height });
          break;
      }
    } catch {
      // Ignore input errors (stale page, navigation race, etc.)
    }
  });

  const stop = (): void => {
    if (screenshotLoop) { clearInterval(screenshotLoop); screenshotLoop = null; }
    clearInterval(pingLoop);
    // Page stays alive — session persists until the idle-cleanup timer fires.
  };

  ws.on('close', stop);
  ws.on('error', stop);
}
