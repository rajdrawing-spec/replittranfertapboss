import app from "./app";
import { logger } from "./lib/logger";
import { ensureSystemRoles } from "./lib/seed-roles";
import { ensureStarterCompanies } from "./lib/seed-companies";
import { startIntegrationScheduler } from "./lib/integration-sync";
import { registerAdapters } from "./lib/adapters";

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

// Browser workspace now uses SSE (Server-Sent Events) instead of WebSocket,
// so a plain app.listen() is sufficient — no http.createServer() needed.
app.listen(port, () => {
  logger.info({ port }, "Server listening");
  void ensureSystemRoles();
  void ensureStarterCompanies();
  registerAdapters();
  startIntegrationScheduler();
}).on('error', (err: Error) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
