import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Encrypted API credentials entered directly in the TapasHub UI.
 * Values are AES-256-GCM encrypted using SESSION_SECRET before storage.
 * `envName` is the canonical env var name (e.g. INTEGRATION_SHOPIFY_1_ADMIN_API_TOKEN)
 * so resolveSecrets() can overlay DB values on top of env vars uniformly.
 */
export const integrationCredentialsTable = pgTable("integration_credentials", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  companyId: integer("company_id").notNull(),
  platformKey: text("platform_key").notNull(),
  envName: text("env_name").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  iv: text("iv").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("integration_cred_conn_env_uq").on(t.connectionId, t.envName),
}));

export type IntegrationCredential = typeof integrationCredentialsTable.$inferSelect;
