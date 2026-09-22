import { sql } from 'drizzle-orm';
import { pgPolicy, timestamp } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Owner policy shared by every user-owned table (docs 02 §6). */
export const ownerPolicy = (name: string, column = 'user_id') =>
  pgPolicy(`${name}_owner`, {
    for: 'all',
    to: authenticatedRole,
    using: sql.raw(`${column} = (select auth.uid())`),
    withCheck: sql.raw(`${column} = (select auth.uid())`),
  });

/** Shared (non-personal) tables: readable by any authenticated user; writes only via service role. */
export const readAllPolicy = (name: string) =>
  pgPolicy(`${name}_read`, { for: 'select', to: authenticatedRole, using: sql`true` });
