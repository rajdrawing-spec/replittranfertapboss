import { defineConfig } from "drizzle-kit";
import path from "path";

// SUPABASE_DB_URL takes priority so drizzle-kit push targets Supabase when set.
const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL must be set. Did you forget to provision a database?");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
