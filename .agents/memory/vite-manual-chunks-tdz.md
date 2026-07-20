---
name: Vite manualChunks circular-chunk crash
description: Why manual vendor chunking was removed from the tapashub build
---
Rule: do not reintroduce `manualChunks` vendor splitting in the tapashub Vite config.

**Why:** The old config (vendor-react / vendor-charts / catch-all vendor-common) produced circular chunks. Dev worked fine, but the production bundle crashed at load with `Cannot access 'A' before initialization` (TDZ) before React mounted — a permanent blank white screen at tapboss.tapashub.com. Rollup's build warnings ("Circular chunk: vendor-common -> vendor-react") were the tell.

**How to apply:** rely on Rollup automatic chunking + React.lazy route splits. If chunk tuning is ever needed, only split true leaf-only libs (e.g. xlsx) and never add a catch-all `node_modules -> vendor-common` bucket. Always treat "Circular chunk" build warnings as release blockers, and verify prod bundles by loading them in a headless browser (playwright-core is in api-server; run scripts from inside that package dir so module resolution works).
