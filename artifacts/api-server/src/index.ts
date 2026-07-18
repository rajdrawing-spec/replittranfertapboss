import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureSystemRoles } from "./lib/seed-roles";
import { ensureStarterCompanies } from "./lib/seed-companies";
import { startIntegrationScheduler } from "./lib/integration-sync";
import { startAiTaskScheduler } from "./lib/ai-tasks/scheduler";
import { initSocketServer } from "./lib/chat/socket-server";
import { startStuckNoteSweeper } from "./lib/meetings/meeting-notes.service";

import { registerAdapters } from "./lib/adapters";
import { applyMigrations, repairOrphanedAllocations } from "./lib/migrations";

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
initSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // 1. Schema migrations — create any missing tables before seeders run.
  // 2. Seed system data (roles + starter companies).
  // 3. Repair orphaned company IDs in fund_allocations AFTER companies exist,
  //    so first-boot seeding doesn't leave the repair as a no-op.
  void applyMigrations()
    .then(() => Promise.all([ensureSystemRoles(), ensureStarterCompanies()]))
    .then(() => repairOrphanedAllocations());
  registerAdapters();
  startIntegrationScheduler();
  startAiTaskScheduler().catch((err) => logger.error({ err }, "Failed to start AI task scheduler"));
  // Fail AI meeting notes stuck in "processing" (e.g. after a mid-pipeline
  // restart) so they become retryable; runs at startup and every 5 minutes.
  startStuckNoteSweeper();
}).on('error', (err: Error) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
