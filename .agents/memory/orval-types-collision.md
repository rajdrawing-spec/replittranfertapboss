---
name: Orval types-directory collision fix
description: How to fix TS2308 when orval generates both Zod const and TypeScript type with the same identifier name.
---

## Problem
Orval with `schemas: { path: "generated/types", type: "typescript" }` generates:
- A Zod `const RunAiAnalysisParams = zod.object(...)` in `generated/api.ts`
- A TypeScript `type RunAiAnalysisParams = { ... }` in `generated/types/runAiAnalysisParams.ts`

When the barrel (`index.ts`) does `export * from "./generated/api"` AND `export * from "./generated/types"`, TypeScript 5.x fires TS2308 "Module has already exported a member" even though one is a value and the other is a type.

Orval also **regenerates** `index.ts` on every codegen run, so manually editing it gets overwritten.

## Fix (applied in this project)

1. Remove `schemas: { path: "generated/types", type: "typescript" }` from `orval.config.ts` for the `zod` target.
2. Update the `codegen` script in `lib/api-spec/package.json` to strip the stale types re-export line after orval runs:
   ```
   "codegen": "orval --config ./orval.config.ts && sed -i \"/generated\\/types/d\" ../api-zod/src/index.ts && pnpm -w run typecheck:libs"
   ```

This works because all types needed by consumers are inferred from the Zod schemas in `api.ts`; the TypeScript-only types directory is redundant.

**Why:** Orval always regenerates the barrel with both exports regardless of the `schemas` config; the sed strip is the only reliable post-gen patch point.

**How to apply:** Any time you run codegen that produces this collision, apply both changes above.
