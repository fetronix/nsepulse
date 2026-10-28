/**
 * Accounts and channel bindings. Nothing here holds market data.
 *
 * Split out of the single schema module so each domain can be read on its own.
 * `src/server/db/schema.ts` re-exports everything, so existing imports keep working and
 * drizzle-kit still sees one schema file.
 */
import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './common.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash'),
    role: varchar('role', { length: 24 }).notNull().default('USER'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)]
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  timezone: varchar('timezone', { length: 80 }).notNull().default('Africa/Nairobi'),
  currency: varchar('currency', { length: 3 }).notNull().default('KES'),
  quietHours: jsonb('quiet_hours'),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  updatedAt: updatedAt()
});

export const telegramAccounts = pgTable(
  'telegram_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramUserId: varchar('telegram_user_id', { length: 32 }).notNull(),
    chatId: varchar('chat_id', { length: 32 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('telegram_accounts_user_uq').on(t.userId),
    uniqueIndex('telegram_accounts_tg_uq').on(t.telegramUserId)
  ]
);
