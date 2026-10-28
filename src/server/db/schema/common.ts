/**
 * Column helpers shared by every table module.
 *
 * Kept in one place so a timestamp column cannot drift into a different definition in one
 * domain than another.
 */
import { timestamp } from 'drizzle-orm/pg-core';

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
