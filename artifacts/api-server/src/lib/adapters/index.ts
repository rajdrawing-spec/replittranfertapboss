import { registerAdapter } from "../integration-adapters";
import { shopifyAdapter } from "./shopify";

/**
 * Register all real per-provider adapters. Platforms without a real adapter
 * fall back to the honest stub (reports credentials present, syncs nothing).
 * Call once at server startup.
 */
export function registerAdapters(): void {
  registerAdapter("shopify", shopifyAdapter);
}
