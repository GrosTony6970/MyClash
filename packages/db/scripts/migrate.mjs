import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const sql = postgres(process.env.DATABASE_URL ?? '');
const db = drizzle(sql);
await migrate(db, { migrationsFolder: '/app/packages/db/migrations' });
await sql.end();
console.log('Migrations complete');
