import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events, lices } from './events';

export const eventStaffAccounts = pgTable('event_staff_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  username: text('username').notNull(),
  pinHash: text('pin_hash').notNull(),
  role: text('role').notNull().default('arbitre_table'),
  status: text('status').notNull().default('active'),
  createdByUserId: uuid('created_by_user_id'),
  disabledByUserId: uuid('disabled_by_user_id'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eventStaffLiceAssignments = pgTable('event_staff_lice_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  staffAccountId: uuid('staff_account_id')
    .notNull()
    .references(() => eventStaffAccounts.id, { onDelete: 'cascade' }),
  liceId: uuid('lice_id')
    .notNull()
    .references(() => lices.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
