/**
 * Database schema.
 *
 * The tables are defined in `./schema/<domain>.ts` by subject area; this module re-exports
 * all of them so `drizzle.config.ts`, the repository layer and the migration tests keep one
 * import path. Splitting by domain was done without changing a single column, index or
 * foreign key, which `npx drizzle-kit generate` confirms by reporting no schema changes.
 */
export * from './schema/identity.js';
export * from './schema/market.js';
export * from './schema/research.js';
export * from './schema/personal.js';
export * from './schema/operations.js';
export * from './schema/common.js';
