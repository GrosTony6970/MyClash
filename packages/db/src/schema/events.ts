/**
 * Events, themes, and lices.
 * Event = the gathering (FAL 2026, Swordfish 2027).
 */
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// ── Events ────────────────────────────────────────────────────────────────────
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  location: text('location'),
  startDate: text('start_date').notNull(), // ISO date
  endDate: text('end_date').notNull(), // ISO date
  status: text('status').notNull().default('draft'),
  // draft | published | running | completed | archived
  themeId: uuid('theme_id'),
  publicLandingMd: text('public_landing_md'),
  penaltyRulesetId: uuid('penalty_ruleset_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Themes ────────────────────────────────────────────────────────────────────
export const themes = pgTable('themes', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  primaryColor: text('primary_color').default('#c0392b'),
  secondaryColor: text('secondary_color').default('#2c3e50'),
  accentColor: text('accent_color').default('#f39c12'),
  logoUrl: text('logo_url'),
  heroImageUrl: text('hero_image_url'),
  fontDisplay: text('font_display').default('Cinzel'),
  fontBody: text('font_body').default('Inter'),
  customCss: text('custom_css'),
});

// ── Lices (pistes / fighting arenas) ─────────────────────────────────────────
export const lices = pgTable('lices', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  locationLabel: text('location_label'),
  colorHex: text('color_hex'),
  sortOrder: integer('sort_order').notNull().default(0),
});
