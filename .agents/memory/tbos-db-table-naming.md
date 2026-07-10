---
name: TBOS DB table naming convention
description: Which schema files export bare names vs -Table suffix names; don't guess without checking.
---

## Rule

Most TBOS schema files export with a `Table` suffix: `transactionsTable`, `ordersTable`, `productsTable`, etc.

However, the **Gemini template** schema files (`lib/db/src/schema/conversations.ts` and `messages.ts`) export **bare names**: `conversations` and `messages` (not `conversationsTable` / `messagesTable`).

**Why:** These were copied from the Gemini integration template which uses a different naming convention.

## Import pattern

```ts
// CORRECT
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";

// WRONG — will TS2724 "no exported member named 'conversationsTable'"
import { db, conversationsTable, messagesTable } from "@workspace/db";
```

**How to apply:** Before importing any DB table, check `lib/db/src/schema/<file>.ts` to confirm the exact export name.
