import http from 'http';
import app from "./app";
import { logger } from "./lib/logger";
import { ensureSystemRoles } from "./lib/seed-roles";
import { ensureStarterCompanies } from "./lib/seed-companies";
import { startIntegrationScheduler } from "./lib/integration-sync";
import { registerAdapters } from "./lib/adapters";
import { setupBrowserWebSocket } from "./browser-sessions/ws-handler";

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

// Create the HTTP server explicitly so we can attach the WebSocket upgrade
// handler for the browser workspace before starting to listen.
const server = http.createServer(app);

// Attach the browser workspace WebSocket upgrade handler.
// This must be called before server.listen() so upgrade events are routed
// correctly from the first connection.
setupBrowserWebSocket(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  void ensureSystemRoles();
  void ensureStarterCompanies();
  registerAdapters();
  startIntegrationScheduler();
});

server.on('error', (err: Error) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
