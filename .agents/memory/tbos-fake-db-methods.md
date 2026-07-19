---
name: TBOS fake DB query-builder methods
description: When copying the in-memory fake Drizzle DB for API tests, include the full QB chain or inserts will fail at runtime.
---

The fake DB used in API tests is a minimal Proxy + query-builder that intercepts Drizzle-like chains. If you copy it from an existing test, include **all** methods that real Drizzle exposes on the chain: `select`, `insert`, `update`, `from`, `values`, `set`, `where`, `orderBy`, `limit`, `for`, `onConflictDoNothing`, `returning`, and `then`.

**Why:** A query that only uses `.select` may pass while a query that uses `.insert(...).values(...).returning(...)` will fail with `TypeError: ... .returning is not a function` if the copied fake DB omits `returning()`. The failure is silent inside a `try/catch` and shows up as empty result sets rather than an obvious mock error.

**How to apply:** When adding a new fake-DB test, always mirror the retry-test fake DB in full, or extend the QB class with the missing methods before writing assertions against insert/update paths.
