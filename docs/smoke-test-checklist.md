# Post-Deploy Smoke Test — Hostinger

Everything below was verified as far as it can be from a terminal — typecheck, build,
booting the server, WCAG contrast math, bundle sizes. What's left needs a real browser
against a real deployment: real Clerk keys, a real Postgres database, and for the
meetings section, two real devices. Go through this once after each deploy that touches
the frontend or the API server; the meetings section only needs re-checking when
`contexts/meeting-context.tsx` or `components/meetings/*` change.

Budget ~20 minutes solo, ~30 if you're also checking meetings with a second person.

## 1. The app loads at all

This is what Phase 1 fixed — confirm it actually holds on the real host, not just in
the local boot test.

- [ ] `https://yourdomain.com/` loads the app (not a 404 — this is the bug that existed
      before Phase 1)
- [ ] `https://yourdomain.com/api/healthz` → `200 {"status":"ok"}`
- [ ] Refresh on a deep link, e.g. `/invoices` or `/orders` → app loads, not a 404
      (confirms the SPA fallback works on the real host, not just locally)
- [ ] Browser console on first load: no red errors before you've done anything

## 2. Sign-in

- [ ] Sign-in page shows the TapasHub logo, wordmark, and tagline immediately — not a
      bare spinner that gets replaced a moment later (that swap was the CLS fix in
      Phase 5; watch for the page visibly "jumping" as it loads)
- [ ] Sign in with a real account → lands on the dashboard
- [ ] Sign out → back to sign-in, no stuck loading state

## 3. Navigation — mobile (resize your browser under 768px, or use a phone)

- [ ] Bottom nav (Home / Planner / Tasks / More) is visible and tappable
- [ ] Tap the search icon in the top bar → full-screen search opens, typing returns
      results, tapping a result navigates and closes the search (**new in Phase 2** —
      there was no way to search on mobile before this)
- [ ] Open **Orders** → tap the **+** floating button (bottom right) → the New Order
      dialog opens (**new in Phase 2** — this button rendered but did nothing before)
- [ ] Same check on **Inventory** (Add Product) and **Planner** (Add Event)
- [ ] Open **CRM** and **AI Tasks** → confirm there is **no** floating **+** button on
      these (correct — they have no create action to attach it to)
- [ ] "More" drawer (bottom nav) opens and lists every section

## 4. Navigation — desktop

- [ ] Sidebar collapse/expand toggle works
- [ ] `⌘K` / `Ctrl+K` focuses the search bar
- [ ] Company switcher (if you have access to more than one) switches context and the
      page data updates

## 5. Responsive tables (Phase 3)

For each of these, check both a wide desktop window (real table) and a narrow mobile
width (stacked cards) — resize mid-page to see it switch live:

- [ ] **Orders**, **Inventory**, **Invoices** — mobile shows cards with a title,
      status badge, and a tap target for row actions (single icon if one action,
      overflow menu if several)
- [ ] **Client Portal → Campaigns** (if you have a client project to view) — this is
      the 10-column table that was the worst offender before Phase 3; confirm it's
      cards on mobile, not a horizontally-scrolling table
- [ ] **Director Portal → Company Performance** table, same check
- [ ] Tapping a card row still opens/navigates the same as clicking a table row does
      on desktop

## 6. Loading / empty / error states (Phase 3)

- [ ] Load a list page on a throttled connection (Chrome DevTools → Network → Slow 4G)
      → see skeleton rows, not a blank flash
- [ ] Go to a section with no data yet (a fresh company with no orders, e.g.) → see an
      empty-state message with an icon, not a bare empty table
- [ ] Turn off wifi/data, then trigger a refetch (pull-to-refresh, or click Retry on
      any page) → see an error state with a **Retry** button, not an empty table
      pretending there's just no data

## 7. Light mode contrast (Phase 4)

This is the one most worth checking carefully — the whole point of the fix was that it
was invisible before, so a quick glance won't catch a regression.

- [ ] Toggle to **light mode** (sun/moon icon, top right)
- [ ] **Invoices** list — status badges (Draft, Sent, Paid, Overdue, etc.) are clearly
      readable, not washed-out pale text
- [ ] **Finance** or **Treasury** — positive/negative amounts (green/red) are readable
      against the light background
- [ ] **HR** — Active/On Leave/Inactive badges readable
- [ ] Toggle back to dark mode → same badges still look correct there (should be
      unchanged — dark mode was already fine before this fix)
- [ ] Open an invoice detail page (`/invoices/:id`) — the printable invoice area stays
      white/light-themed **regardless of app theme** (this is intentional, not a bug —
      it's meant to look like a printed document)

## 8. Excel export (lazy-loaded in Phase 5)

- [ ] **Finance** → Export → Excel file downloads and opens correctly
- [ ] **Treasury** → Export → same
- [ ] Open DevTools → Network tab before clicking Export, confirm a new JS chunk
      (`xlsx-*.js`) loads at the moment you click Export, not on initial page load

## 9. Meetings — needs a second person

This is the highest-risk area of this round of changes: `MeetingProvider` was
completely unmounted before Phase 5 (this whole feature was silently broken — the AI
Tasks page crashed outright), and I could not exercise the live call path without real
LiveKit credentials and two connected browsers.

- [ ] From **AI Tasks**, start a meeting/call with a colleague
- [ ] Both sides see and hear each other (camera + mic)
- [ ] Minimize the call (should shrink to a mini-player) and navigate to a different
      page — the call keeps running, audio doesn't drop
- [ ] Expand it back to full screen from the mini-player
- [ ] One side leaves the call → the other side sees them disconnect cleanly
- [ ] Refresh the page mid-call → the call auto-rejoins (this is the
      reload-recovery path in `meeting-context.tsx`)
- [ ] Have someone call you while you're on a **different page** (not AI Tasks) →
      the incoming-call popup appears (confirms the provider is genuinely global now,
      not just active on the AI Tasks route)
- [ ] Check DevTools Network tab on a page where you never open a meeting (e.g. just
      browsing Orders for a while) → confirm `livekit-client.esm-*.js`,
      `livekit-room-*.js`, and `meeting-recorder-*.js` never load

## 10. PWA / install

- [ ] "Install app" prompt appears (or install manually via browser menu) on a
      supported browser
- [ ] Installed app opens to the sign-in/dashboard correctly
- [ ] After a fresh deploy, existing installed clients pick up the new version within
      one reload (no stuck "old version" — this is the `skipWaiting`/`clientsClaim`
      behavior from the PWA config)

## 11. Performance — re-run Lighthouse

The repo's `artifacts/tapashub/lighthouse-report.json` is the baseline this whole audit
was measured against (0.34 performance, CLS 0.278, 15.2s FCP) — but it was captured
against a **dev server**, which inflates several numbers (unminified JS, etc.). Run a
fresh one against the real Hostinger deployment for numbers that actually mean
something:

- [ ] Chrome DevTools → Lighthouse → run against the production URL (not localhost)
- [ ] CLS should now read near-zero (was 0.278, dominated by the sign-in page fix)
- [ ] Performance score — compare against the baseline, but expect it to look
      different by nature of testing prod vs. dev, not apples-to-apples with the
      original 0.34

---

## If something fails

- **App won't load at all** → re-check `docs/deployment-hostinger.md`, especially the
  `SUPABASE_DB_URL` vs `DATABASE_URL` distinction — that's the #1 way this silently
  won't start.
- **Meetings don't connect** → check `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET` are set; `components/meetings/livekit-provider.ts` treats
  meetings as unconfigured if any of the three is missing.
- **Anything else** → check the server logs (`pino` structured JSON) for the request in
  question; the API error handler from Phase 1 logs every 5xx at `fatal`/`error` level
  with the failing path.
