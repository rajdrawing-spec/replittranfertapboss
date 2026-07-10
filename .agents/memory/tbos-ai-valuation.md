---
name: TBOS AI valuation & predictions
description: Pitfalls and decisions from the AI valuation/predictions/market intelligence feature
---

# TBOS AI valuation, predictions & market intelligence

## useMutation default-parameter pitfall

**Rule:** Never use `mutationFn: (arg = defaultValue)` — TanStack Query infers `TVariables = void` when the argument has a default, making `.mutate(value)` a type error ("Argument of type 'boolean' is not assignable to parameter of type 'void'").

**Why:** TypeScript sees the optional signature `(arg?: T)` and folds it into `void`-compatibility for the mutation variables type.

**How to apply:** Always declare the parameter explicitly with no default: `mutationFn: (force: boolean) =>`. Pass all values at call site. If you need generic typing on the mutation, add it: `useMutation<ReturnType, Error, ArgType>({ mutationFn: ... })`.

## Frontend: raw adminApi for routes not in OpenAPI spec

**Rule:** New AI endpoints (valuation, predictions, market) were added directly as `adminApi.get/post` calls with manually defined TypeScript interfaces — not via generated `@workspace/api-client-react` hooks — because they were not added to `lib/api-spec/openapi.yaml`.

**Why:** Codegen runs from the spec; routes outside the spec produce no hooks. Task #39 tracks adding them.

**How to apply:** Until Task #39 is done, frontend callers import `adminApi` from `@/lib/admin-api` and define local interfaces (AiValuation, AiPredictions, AiMarketAnalysis). Once the spec + codegen are updated, migrate to generated hooks and remove the local interface definitions.

## DB lib schema export ordering

**Rule:** `lib/db/src/schema/index.ts` must explicitly export `./conversations` and `./messages` after `./ai`. These were accidentally removed when editing the file and caused `TS2305: Module '"@workspace/db"' has no exported member` errors in `gemini.ts`.

**How to apply:** After any edit to schema/index.ts, grep for conversations and messages exports to confirm they are still present. Run `pnpm run typecheck:libs` before touching API server typecheck.

## AI prompt JSON parsing pattern

All three new AI route handlers use the same normalization chain:
```ts
const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
let parsed: Record<string, unknown>;
try { parsed = JSON.parse(jsonStr); }
catch { res.status(502).json({ error: "AI returned unexpected format. Please retry." }); return; }
```
This strips markdown fences before parsing. The 502 error is intentional — it signals the upstream AI failure, not a server error.
