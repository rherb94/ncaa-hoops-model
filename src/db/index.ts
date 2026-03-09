// src/db/index.ts
// Drizzle database client.
// Uses @vercel/postgres (Neon serverless driver) which works in both
// Next.js serverless functions and local development via POSTGRES_URL env var.

import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import * as ncaamSchema from "./schema";

export const db = drizzle(sql, { schema: ncaamSchema });

// Re-export schema tables for convenience
export { ncaam, ncaaw, schemaByLeague } from "./schema";
