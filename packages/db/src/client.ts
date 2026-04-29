/**
 * Drizzle ORM client factory.
 *
 * Usage in NestJS services:
 *   import { createDb } from '@myclash/db';
 *   const db = createDb(process.env.DATABASE_URL);
 *
 * The connection is a postgres.js pool. Call db.$client.end() on shutdown.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}
