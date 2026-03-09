// drizzle.config.ts
// Configuration for Drizzle Kit (migration generation + introspection).
//
// Usage:
//   npm run db:generate   — generate SQL migrations from schema changes
//   npm run db:migrate    — apply pending migrations to Vercel Postgres
//   npm run db:studio     — open Drizzle Studio (local DB browser)

// Load .env.local (Next.js loads it automatically but drizzle-kit doesn't)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out:    "./drizzle",           // SQL migration files
  dialect: "postgresql",
  dbCredentials: {
    // Use the direct (non-pooling) URL for migrations — pgbouncer doesn't
    // support DDL statements. Falls back to POSTGRES_URL if not set.
    url: (process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL)!,
  },
  // Verbose output during migration
  verbose: true,
  strict:  true,
} satisfies Config;
