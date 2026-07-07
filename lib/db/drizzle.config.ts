import { defineConfig } from "drizzle-kit";
import path from "path";

// SUPABASE_DB_URL takes priority so drizzle-kit push/migrate targets Supabase.
// Falls back to DATABASE_URL for local dev push. Neither is required for
// schema-only commands like `drizzle-kit generate` which don't need a live DB.
const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

const schemaPath = path.join(__dirname, "./src/schema/index.ts");

export default defineConfig({
  schema: schemaPath,
  dialect: "postgresql",
  // dbCredentials is only needed for push/migrate; generate works without it.
  ...(url ? { dbCredentials: { url } } : {}),
});
