import { defineConfig } from 'drizzle-kit';

// Only used by `bun run db:generate` to write SQL migrations into drizzle/.
// The app applies them itself at boot (SqliteDatabase.migrate), so the runtime
// never needs drizzle-kit or this file.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
});
