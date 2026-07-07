import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

// SUPABASE_DB_URL is the persistent Supabase database — unaffected by
// Replit's publish-time "overwrite with dev data" flow.
// In production it is required; in development we fall back to Replit's
// managed DATABASE_URL so local dev still works without the secret.
const isSupabase = !!process.env.SUPABASE_DB_URL;
const connectionString = process.env.SUPABASE_DB_URL ||
  (!isProduction ? process.env.DATABASE_URL : undefined);

if (!connectionString) {
  throw new Error(
    isProduction
      ? "SUPABASE_DB_URL must be set in production. Check your deployment secrets."
      : "SUPABASE_DB_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString,
  // Supabase requires SSL. Enforce it explicitly as a safety net even when
  // sslmode is already present in the URL.
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  // Supabase free tier allows ~60 direct connections. Keep pool small for
  // autoscale deployments where multiple instances may be running.
  max: isSupabase ? 5 : 10,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
