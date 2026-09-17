import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

export function createPool(databaseUrl: string) {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
