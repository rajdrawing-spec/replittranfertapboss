import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// SUPABASE_DB_URL takes priority (external persistent DB, unaffected by
// Replit's publish-time "overwrite with dev data" flow).
// Falls back to Replit's managed DATABASE_URL for local development.
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DB_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase requires SSL; node-postgres reads sslmode from the URL so no extra
// config is needed when the URL includes ?sslmode=require (Supabase default).
export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
