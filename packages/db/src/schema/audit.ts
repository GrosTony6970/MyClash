/**
 * Audit log — append-only record of all significant actions.
 */
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLog = pgTable('audit_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  actorUserId:  uuid('actor_user_id'),
  action:       text('action').notNull(),
  entityType:   text('entity_type').notNull(),
  entityId:     text('entity_id').notNull(),
  payloadJson:  jsonb('payload_json'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
