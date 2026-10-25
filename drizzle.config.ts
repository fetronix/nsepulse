import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './src/server/db/schema.ts', out: './drizzle/generated', dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/nse_pulse' } });
