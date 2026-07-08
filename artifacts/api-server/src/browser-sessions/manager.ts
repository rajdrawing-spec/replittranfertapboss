/**
 * BrowserSessionManager
 *
 * Manages one Playwright BrowserContext (= Chrome Profile) per company.
 * Each context uses a dedicated userDataDir, giving complete isolation:
 *   - Separate cookies per origin
 *   - Separate localStorage / sessionStorage
 *   - Separate saved credentials and sessions
 *
 * Multiple platform pages (tabs) run inside the same company context,
 * matching Chrome's profile model: one profile, many tabs.
 *
 * Sessions are closed automatically after 30 minutes of inactivity.
 * Profiles are persisted on disk so sessions survive server restarts.
 */

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';

// Store profiles inside the workspace so they survive container restarts.
const PROFILES_BASE = path.join(process.cwd(), '.browser-profiles');

// ── Chromium discovery ───────────────────────────────────────────────────────

let _executablePath: string | null = null;

function findChromium(): string {
  const candidates = [
    'chromium',
    'chromium-browser',
    'google-chrome-stable',
    'google-chrome',
  ];
  for (const bin of candidates) {
    try {
      const result = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8' })
        .trim()
        .split('\n')[0];
      if (result) return result;
    } catch {
      // try next
    }
  }
  throw new Error(
    'Chromium not found in PATH. Add pkgs.chromium to replit.nix deps.',
  );
}

function getExecutablePath(): string {
  if (!_executablePath) _executablePath = findChromium();
  return _executablePath;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActiveSession {
  companyId: number;
  platforms: string[];
  lastActivity: number;
}

interface CompanySession {
  context: BrowserContext;
  /** One Page per platform key — like browser tabs in a profile. */
  pages: Map<string, Page>;
  lastActivity: number;
  companyId: number;
}

// ── Manager ──────────────────────────────────────────────────────────────────

class BrowserSessionManager {
  private sessions = new Map<number, CompanySession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    mkdirSync(PROFILES_BASE, { recursive: true });
    // Sweep idle sessions every 5 minutes.
    this.cleanupTimer = setInterval(() => {
      void this.cleanupIdle();
    }, 5 * 60_000);
  }

  /**
   * Returns the Page for the given (company, platform) pair, creating it if
   * it does not exist or was closed.
   *
   * Returns { page, isNew } so callers can decide whether to navigate.
   * Navigation is intentionally NOT done here — callers should fire it in the
   * background after the screenshot loop has started, so the user sees the
   * browser loading live rather than waiting for a full page load first.
   */
  async getOrCreatePage(
    companyId: number,
    platformKey: string,
    viewport = { width: 1280, height: 800 },
  ): Promise<{ page: Page; isNew: boolean }> {
    const session = await this.getOrCreateSession(companyId, viewport);

    let page = session.pages.get(platformKey);
    const isNew = !page || page.isClosed();
    if (isNew) {
      page = await session.context.newPage();
      await page.setViewportSize(viewport);
      session.pages.set(platformKey, page);
    }

    session.lastActivity = Date.now();
    return { page: page!, isNew };
  }

  async closePlatformPage(
    companyId: number,
    platformKey: string,
  ): Promise<void> {
    const session = this.sessions.get(companyId);
    if (!session) return;
    const page = session.pages.get(platformKey);
    if (page && !page.isClosed()) await page.close().catch(() => void 0);
    session.pages.delete(platformKey);
  }

  getActiveSessions(): ActiveSession[] {
    return Array.from(this.sessions.entries()).map(([companyId, s]) => ({
      companyId,
      platforms: Array.from(s.pages.keys()),
      lastActivity: s.lastActivity,
    }));
  }

  private async getOrCreateSession(
    companyId: number,
    viewport: { width: number; height: number },
  ): Promise<CompanySession> {
    const existing = this.sessions.get(companyId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    const userDataDir = path.join(PROFILES_BASE, `company-${companyId}`);
    mkdirSync(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: getExecutablePath(),
      viewport,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--font-render-hinting=none',
      ],
    });

    const session: CompanySession = {
      context,
      pages: new Map(),
      lastActivity: Date.now(),
      companyId,
    };
    this.sessions.set(companyId, session);
    return session;
  }

  private async cleanupIdle(): Promise<void> {
    const threshold = 30 * 60_000; // 30 minutes
    const now = Date.now();
    for (const [companyId, session] of this.sessions) {
      if (now - session.lastActivity > threshold) {
        try {
          await session.context.close();
        } catch {
          // ignore close errors
        }
        this.sessions.delete(companyId);
      }
    }
  }
}

export const browserSessionManager = new BrowserSessionManager();
