/**
 * Directory groups — a logged-in user's personal, private collections of
 * global_persons (fighters). Organizer/bookmark only; no notifications (those
 * live on the event-scoped `follows` table). Ownership is claimed-user only.
 */
import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { fighters } from './fighters';

// ── Groups ──────────────────────────────────────────────────────────────────
export const directoryGroups = pgTable('directory_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  // auth.users(id) — bare uuid (no cross-schema Drizzle FK), like follows.follower_user_id.
  // ON DELETE CASCADE to auth.users enforced via migration SQL.
  ownerUserId: uuid('owner_user_id').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// UNIQUE(owner_user_id, lower(name)) enforced via migration SQL

// ── Members ─────────────────────────────────────────────────────────────────
export const directoryGroupMembers = pgTable(
  'directory_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => directoryGroups.id, { onDelete: 'cascade' }),
    globalPersonId: uuid('global_person_id')
      .notNull()
      .references(() => fighters.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupPersonUq: unique('directory_group_members_group_person_uq').on(
      table.groupId,
      table.globalPersonId,
    ),
  }),
);
