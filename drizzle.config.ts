// drizzle.config.ts
// Configuration for Drizzle Kit (migration generation + introspection).
//
// Usage:
//   npm run db:generate   — generate SQL migrations from schema changes
//   npm run db:migrate    — apply pending migrations to Vercel Postgres
//   npm run db:studio     — open Drizzle Studio (local DB browser)

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out:    "./drizzle",           // SQL migration files
  dialect: "postgresql",
  dbCredentials: {
    // Set POSTGRES_URL in .env.local (Vercel auto-injects it in production)
    url: process.env.POSTGRES_URL!,
  },
  // Verbose output during migration
  verbose: true,
  strict:  true,
} satisfies Config;
