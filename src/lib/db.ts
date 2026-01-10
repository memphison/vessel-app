import { Pool } from "pg";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
declare global {
  var __PG_POOL__: Pool | undefined;
}

export function getDb(): Pool {
  if (!global.__PG_POOL__) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }

    global.__PG_POOL__ = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false, // REQUIRED for Railway in all environments
      },
    });
  }

  return global.__PG_POOL__;
}
