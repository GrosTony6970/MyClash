/**
 * Venue is an org-level catalogue of physical locations reusable
 * across many events. A venue can host tournaments, workshops, or
 * both — flagged separately. Areas split a venue into concurrent
 * workshop spaces; a venue with 0 or 1 area means workshop
 * sessions link directly to the venue without picking an area.
 *
 * Schema lives in migration 0088_venues.sql + Drizzle schema
 * `packages/db/src/schema/venues.ts`. Lices and workshop_sessions
 * point at venues (and optionally areas) via the columns added in
 * the same migration.
 */
export interface Venue {
  id: string;
  organizationId: string;
  name: string;
  address: string | null;
  hostsTournament: boolean;
  hostsWorkshop: boolean;
  sortOrder: number;
}

export interface VenueArea {
  id: string;
  venueId: string;
  name: string;
  sortOrder: number;
}
