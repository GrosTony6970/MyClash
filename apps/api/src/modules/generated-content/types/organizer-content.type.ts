import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../../organizations/organizations.service';
import { SupabaseService } from '../../supabase/supabase.service';
import type { ContentTypeDef, GenScope } from '../content-type.interface';

interface EventRow {
  id: string;
  name: string;
  /** `events.location` was RENAMED to `city`; the old name 400'd every load. */
  city: string | null;
  start_date: string;
  end_date: string;
  organization_id: string;
}

/** AI-drafted public event description — a draft the organizer edits/uses (never auto-published). */
@Injectable()
export class OrganizerContentType implements ContentTypeDef {
  readonly contentType = 'organizer_content';
  readonly entityType = 'event';
  readonly keySource = 'org' as const;
  readonly canPublish = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  private async loadEvent(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, name, city, start_date, end_date, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as EventRow;
  }

  async resolveScope(entityId: string): Promise<GenScope> {
    const e = await this.loadEvent(entityId);
    return { orgId: e.organization_id, eventId: e.id };
  }

  async assertAccess(entityId: string, userId: string): Promise<void> {
    const e = await this.loadEvent(entityId);
    await this.orgs.assertOrgRole(e.organization_id, userId, 'admin');
  }

  async buildContext(entityId: string): Promise<Record<string, unknown>> {
    const e = await this.loadEvent(entityId);
    const { data: tData } = await this.supabase.service
      .from('tournaments')
      .select('name, weapon')
      .eq('event_id', entityId);
    const { data: wData } = await this.supabase.service
      .from('workshops')
      .select('title')
      .eq('event_id', entityId)
      .limit(20);
    return {
      event: e.name,
      // The prompt's own vocabulary stays `location`; only the column moved.
      location: e.city,
      startDate: e.start_date,
      endDate: e.end_date,
      tournaments: ((tData ?? []) as Array<{ name: string; weapon: string | null }>).map((t) => ({
        name: t.name,
        weapon: t.weapon,
      })),
      workshops: ((wData ?? []) as Array<{ title: string | null }>)
        .map((w) => w.title)
        .filter((title): title is string => Boolean(title)),
    };
  }

  systemPrompt(locale: string): string {
    return [
      'You write an inviting public description for a HEMA (historical European martial arts) event.',
      'You are given a JSON object of FACTS. Use ONLY those facts — never invent tournaments, workshops, dates, or venues.',
      'Make it welcoming and clear: what the event is, when and where it happens, and what competitors can take part in (tournaments by weapon, workshops).',
      'Keep it to 2-4 short paragraphs. No headings, no markdown tables. This is a draft the organizer will edit.',
      `Write in this language (ISO code): ${locale}.`,
    ].join('\n');
  }
}
