---
name: TBOS Vitest + workspace JSX
description: Vitest tests fail to resolve react/jsx-dev-runtime for workspace packages that contain JSX; add react/react-dom as devDependencies
---

Tapashub tests import workspace packages that contain JSX (e.g. `@workspace/object-storage-web`). If that package only declares `react` as a peer dependency, Vitest/Vite cannot resolve `react/jsx-dev-runtime` from the package's source files, because pnpm does not link `react` into the package's own `node_modules` for peer deps.

Fix: add `react` and `react-dom` as devDependencies of the workspace package (using the catalog version) so pnpm installs the runtime in the package's node_modules and Vite can resolve the JSX transform.

**Why:** The generated import `react/jsx-dev-runtime` is resolved relative to the file being transformed, not from the test runner's node_modules. Peer-only packages don't get the runtime symlinked.
