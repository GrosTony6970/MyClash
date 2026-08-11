import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  summariseFeedback,
  type FeedbackRow,
  type FeedbackSummary,
  type RespondentRole,
} from './event-feedback';

type Row = Record<string, unknown>;

export interface SubmitFeedbackInput {
  rating: number;
  comment?: string | null;
  isAttributed?: boolean;
}

/**
 * Post-event feedback: writing it as a participant, reading it as an organiser.
 *
 * Split from EventStatsService rather than bolted onto it because the two have
 * different audiences and different guards — this one is written by anyone on
 * the roster and read by the organiser, and folding it in would put a
 * participant-facing write inside a scorekeeper-guarded service.
 */
@Injectable()
export class EventFeedbackService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * Which role this person held at this event, read from the roster.
   *
   * NEVER taken from the client: a fighter filing as a referee would shift what
   * an organiser concludes about their officials, and the respondent is the one
   * party with a motive to misreport it.
   *
   * `event_referees.person_id` and `event_instructors.person_id` hold GLOBAL
   * person ids while feedback keys on the event-scoped `persons.id`, so the
   * lookup bridges through `persons.global_person_id`. Precedence runs
   * referee → instructor → fighter → attendee: someone who both fought and
   * refereed is asked about the day as an official, because that is the
   * experience the organiser has the least other visibility into.
   */
  private async deriveRole(eventId: string, personId: string): Promise<RespondentRole> {
    const { data: person } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id')
      .eq('id', personId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (!person) throw new NotFoundException('You are not on this event roster');
    const globalId = (person as Row)['global_person_id'] as string | null;

    if (globalId) {
      const { data: referee } = await this.supabase.service
        .from('event_referees')
        .select('person_id')
        .eq('event_id', eventId)
        .eq('person_id', globalId)
        .maybeSingle();
      if (referee) return 'referee';

      const { data: instructor } = await this.supabase.service
        .from('event_instructors')
        .select('person_id')
        .eq('event_id', eventId)
        .eq('person_id', globalId)
        .maybeSingle();
      if (instructor) return 'instructor';
    }

    // A registration in ANY of the event's tournaments. `registrations` has no
    // event_id — the reach is through tournaments, and a direct filter would
    // 400 into "not a fighter", quietly demoting every competitor to attendee.
    const { data: registration } = await this.supabase.service
      .from('registrations')
      .select('id, tournaments!inner(event_id)')
      .eq('person_id', personId)
      .eq('tournaments.event_id', eventId)
      .limit(1)
      .maybeSingle();
    if (registration) return 'fighter';

    return 'attendee';
  }

  /**
   * Record one response, replacing any earlier one from the same person.
   *
   * Upsert rather than insert: a second thought is the same respondent, and
   * appending would let one person move the average twice.
   */
  async submit(eventId: string, personId: string, input: SubmitFeedbackInput): Promise<void> {
    const respondentRole = await this.deriveRole(eventId, personId);
    const { error } = await this.supabase.service.from('event_feedback').upsert(
      {
        event_id: eventId,
        respondent_person_id: personId,
        respondent_role: respondentRole,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        is_attributed: input.isAttributed ?? false,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: 'event_id,respondent_person_id' },
    );
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * The organiser's view. Anonymous unless the respondent opted in.
   *
   * The name is embedded for EVERY row by PostgREST and then dropped here for
   * unattributed ones, rather than issuing two queries — but the drop happens
   * before the rows reach `summariseFeedback`, so no unattributed name exists
   * anywhere in the value that leaves this method.
   */
  async summary(eventId: string, userId: string): Promise<FeedbackSummary> {
    const { data: event } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    await this.orgs.assertOrgRole(String((event as Row)['organization_id']), userId, 'scorekeeper');

    const { data, error } = await this.supabase.service
      .from('event_feedback')
      .select('respondent_role, rating, comment, is_attributed, persons(given_name, family_name)')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);

    const rows: FeedbackRow[] = ((data ?? []) as Row[]).map((row) => {
      const attributed = row['is_attributed'] === true;
      const person = row['persons'] as { given_name?: string; family_name?: string } | null;
      return {
        respondentRole: row['respondent_role'] as RespondentRole,
        rating: Number(row['rating']),
        comment: (row['comment'] as string | null) ?? null,
        isAttributed: attributed,
        // Dropped here, not in the aggregator: an unattributed name must not
        // exist in any object this method constructs.
        respondentName: attributed
          ? `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim() || null
          : null,
      };
    });

    return summariseFeedback(rows);
  }
}
