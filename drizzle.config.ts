import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/platform/database/system/*.table.ts', './src/modules/*/schema/*.table.ts'],
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://sleek:sleek@localhost:5432/sleek',
  },
});
