---
name: TBOS shareholder module
description: How the shareholder / cap-table module keeps equity data consistent and tenant-safe.
---

# Shareholder management & cap table

Shareholders hold equity in a single company (`shareholders` table); every share
event is logged in `share_transactions`. `ownershipPercent` is **derived, never
authoritative** — it is recomputed for ALL holders of a company (shares / total
issued shares) inside the same DB transaction as any create/update/delete/txn.
Cap-table valuation = total shares × the highest per-share price any holder paid;
each holder's equity value is their share slice of that valuation.

## Server must own the invariants — don't trust the client
**Rule:** equity mutation endpoints validate and canonicalize on the backend, not
just in the UI form.
**Why:** a code review caught that the transaction endpoint trusted client-sent
`shares`/`amount` signs (a "sale" with positive shares would *inflate* a holding),
PATCH bypassed validation entirely (raw strings reaching numeric columns → 500s),
and the position math read the holder row *outside* the transaction (lost updates
under concurrency).
**How to apply:** (1) derive direction from the transaction TYPE — sale removes
shares & lowers invested, dividend is cash-only, everything else adds; amount is
always stored as a non-negative magnitude. (2) Enforce enums (type/role/status/
tx-type) and non-negative/integer numeric bounds in a shared validator on POST,
PATCH, and the transaction route (drizzle-zod only checks JS types). (3) Re-read
the holder row with `.for("update")` INSIDE the txn before applying deltas.
