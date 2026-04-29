/**
 * Organizations and membership tables.
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ── Organizations ─────────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id:              uuid('id').primaryKey().defaultRandom(),
  slug:            text('slug').notNull().unique(),
  name:            text('name').notNull(),
  contactEmail:    text('contact_email'),
  status:          text('status').notNull().default('active'), // active | suspended
  createdByUserId: uuid('created_by_user_id'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Organization members ──────────────────────────────────────────────────────
export const organizationMembers = pgTable('organization_members', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull(),
  role:           text('role').notNull().default('admin'),
  // owner | admin | editor | scorekeeper | referee | workshop_lead | read_only
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
