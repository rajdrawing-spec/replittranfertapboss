import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureSystemRoles } from "./lib/seed-roles";
import { ensureStarterCompanies } from "./lib/seed-companies";
import { startIntegrationScheduler } from "./lib/integration-sync";
import { startAiTaskScheduler } from "./lib/ai-tasks/scheduler";

import { initSocketServer } from "./lib/chat/socket-server";
import { registerAdapters } from "./lib/adapters";
import { applyMigrations, repairOrphanedAllocations, removeAutoAllocationRows } from "./lib/migrations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

if (!process.env["SESSION_SECRET"]) {
  throw new Error("SESSION_SECRET environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Attach Socket.IO (mounted at /api/socket.io) before the server starts
// accepting connections. The frontend opens a socket from meeting-context and
// dm-notification-context on load; without this the handshake 404s and the
// client retries in a loop, so chat, presence and meeting notifications never
// work and mobile clients burn battery reconnecting.
initSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // 1. Schema migrations — create any missing tables before seeders run.
  // 2. Seed system data (roles + starter companies).
  // 3. Repair orphaned company IDs in fund_allocations AFTER companies exist,
  //    so first-boot seeding doesn't leave the repair as a no-op.
  //
  // The chain must end in a .catch(). Without one, any failure here — most
  // commonly the database being briefly unreachable at boot, which managed
  // Postgres does routinely — becomes an unhandled rejection, and Node
  // terminates the process even though the server is already listening and
  // serving. Under a process manager that turns one transient blip into a
  // crash loop. Migrations and seeders are idempotent and run again on the
  // next boot, so the right response is to log loudly and stay up rather
  // than take the whole app down.
  void applyMigrations()
    .then(() => Promise.all([ensureSystemRoles(), ensureStarterCompanies()]))
    .then(() => repairOrphanedAllocations())
    .then(() => removeAutoAllocationRows())
    .catch((err) =>
      logger.fatal(
        { err },
        "Startup migrations/seeding failed — the server is still listening, but database-backed routes will fail until this is resolved.",
      ),
    );
  registerAdapters();
  startIntegrationScheduler();
  startAiTaskScheduler().catch((err) => logger.error({ err }, "Failed to start AI task scheduler"));
}).on('error', (err: Error) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
