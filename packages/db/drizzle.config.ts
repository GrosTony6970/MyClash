import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://postgres:dev-password@localhost:5432/myclash',
  },
  // Verbose output during migrations
  verbose: true,
  strict: true,
});
