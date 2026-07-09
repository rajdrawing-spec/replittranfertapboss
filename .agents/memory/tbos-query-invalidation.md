---
name: TBOS react-query invalidation pitfall
description: Why broad invalidation keys don't work and which exact keys must be used.
---

## Rule
`qc.invalidateQueries({ queryKey: ["/api/treasury"] })` does **NOT** invalidate `["/api/treasury/summary"]` or `["/api/treasury/entries"]`. React Query matches the first array element exactly — `/api/treasury` ≠ `/api/treasury/summary`.

Always invalidate each exact query key used by the components:

```typescript
// After treasury-related mutations:
void qc.invalidateQueries({ queryKey: ["/api/treasury/summary"] })
void qc.invalidateQueries({ queryKey: ["/api/treasury/entries"] })
void qc.invalidateQueries({ queryKey: ["/api/treasury/working-capital"] })
```

The `/api/treasury/working-capital` key feeds the sidebar widget. It must be included in the invalidation set for both treasury entry mutations AND fund-allocation mutations (since allocations affect the working capital snapshot).

**Why:** Broad key caused the sidebar and treasury page to stay stale after mutations.

**How to apply:** Whenever adding a new treasury-related query, add its key to the invalidation list in both treasury.tsx and fund-allocations.tsx.
