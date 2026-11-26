import type { McpCaller, McpToolDeps } from '../mcp-server';
import { ROLE_WORDS, type RoleWord } from './whoami';

export interface MyEventsAnswer {
  events: {
    name: string;
    slug: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    kind: string;
    roles: RoleWord[];
    tournaments: {
      name: string;
      slug: string;
      weapon: string | null;
      registered: boolean;
      poolName: string | null;
    }[];
    refereeOf: {
      tournamentName: string | null;
      poolName: string | null;
      role: string | null;
      liceName: string | null;
    }[];
    teaching: {
      workshopName: string;
      start: string | null;
      end: string | null;
      location: string | null;
      cancelled: boolean;
    }[];
  }[];
}

/**
 * The person's own Events, as the personal space lists them, in names. Each field is picked by
 * hand: a service row has ids, registration ids, seeds and bib numbers a model has no use for.
 */
export async function myEvents(caller: McpCaller, deps: McpToolDeps): Promise<MyEventsAnswer> {
  const entries = await deps.meEvents.listMyEvents({ userId: caller.userId, staff: null });
  return {
    events: entries.map((entry) => ({
      name: entry.event.name,
      slug: entry.event.slug,
      startDate: entry.event.startDate,
      endDate: entry.event.endDate,
      status: entry.event.status,
      kind: entry.event.kind,
      roles: ROLE_WORDS.filter(([flag]) => entry.roles[flag]).map(([, word]) => word),
      tournaments: entry.tournaments.map((t) => ({
        name: t.name,
        slug: t.slug,
        weapon: t.weapon,
        registered: t.registered,
        poolName: t.poolName,
      })),
      refereeOf: entry.refereeOf.map((r) => ({
        tournamentName: r.tournamentName,
        poolName: r.poolName,
        // The skill's name, as the app shows it; the raw role is a skill id (`custom-<hex>-<nonce>`).
        role: r.skillName ?? r.role,
        liceName: r.liceName,
      })),
      teaching: entry.workshopsTeaching.map((w) => ({
        workshopName: w.workshopName,
        start: w.sessionStart,
        end: w.sessionEnd,
        location: w.location,
        cancelled: w.sessionCancelled,
      })),
    })),
  };
}
