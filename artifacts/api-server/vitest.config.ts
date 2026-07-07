import { defineConfig } from "vitest/config";

// Standalone Vitest config for the API server. Runs backend unit/integration
// tests in a Node environment. All external boundaries (Postgres via
// @workspace/db, Clerk via @clerk/express) are mocked per-test, so no real
// database or OAuth is required.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
