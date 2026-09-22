import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/common/db/schema and applied with `pnpm db:migrate`
// (src/common/db/migrate.ts) against DATABASE_DIRECT_URL — never automatically in production.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/common/db/schema/index.ts',
  out: './src/common/db/migrations',
  dbCredentials: { url: process.env.DATABASE_DIRECT_URL ?? '' },
  // Supabase-managed schemas are referenced (auth.users) but never migrated by us.
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  strict: true,
  verbose: true,
});
