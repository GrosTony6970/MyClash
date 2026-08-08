import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { hashPassToken, looksLikePassToken, mintPassToken, passExpiryFor } from './pass-token';

/** What the participant's device is handed. The raw token exists only here and there. */
export interface IssuedPass {
  token: string;
  expiresAt: string | null;
}

/** The emailed link's landing page, before any session exists. */
export interface PassPreview {
  givenName: string;
  familyName: string;
  eventName: string;
  eventSlug: string;
  startDate: string | null;
}

/**
 * Event passes: issue, resolve, preview.
 *
 * One owner for the pass secret. Every caller — the participant issuing their
 * own, the organiser mailing a batch, the desk scanning one — goes through here,
 * so there is exactly one place that knows a raw token is never stored and never
 * re-read.
 *
 * Deliberately has NO opinion about arrival. Resolving a token answers "who is
 * this?" and stops; `CheckinService` decides what to do with the answer. Keeping
 * the two apart is what lets the gear desk adopt scanning later without
 * inheriting an arrival write it must not make.
 */
@Injectable()
export class PassService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Issue a pass, replacing any previous one for this person at this event.
   *
   * The raw token is returned exactly once, here. It is never written down and
   * cannot be recovered — see 0176's header for why that is the point and what
   * the caller must therefore do with it.
   */
  async issue(eventId: string, personId: string, via: 'self' | 'email'): Promise<IssuedPass> {
    const token = mintPassToken();
    const expiresAt = passExpiryFor(await this.eventEndDate(eventId));

    const { error } = await this.supabase.service.from('event_passes').upsert(
      {
        event_id: eventId,
        person_id: personId,
        token_hash: hashPassToken(token),
        issued_via: via,
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
        // A reissue is a new credential, so its scan history starts over. The
        // OLD token's counts are not worth preserving under a value it can no
        // longer produce.
        last_scanned_at: null,
        scan_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_id,person_id' },
    );
    if (error) throw new BadRequestException(error.message);

    return { token, expiresAt };
  }

  /**
   * Who does this scanned token belong to, at this event?
   *
   * Scoped to the scanning staff account's event, so a pass from last month's
   * event resolves to nothing here rather than to a person the desk then fails
   * to mark. Records the scan instead of consuming the token — a pass is
   * presented many times across a weekend.
   */
  async resolve(rawToken: string, eventId: string): Promise<{ personId: string }> {
    const token = rawToken.trim();
    // Cheap shape check first: a desk pointed at a poster or a wifi QR decodes
    // a frame at a time, and none of those should become a database round trip.
    if (!looksLikePassToken(token)) throw new NotFoundException('pass_not_recognized');

    const { data, error } = await this.supabase.service
      .from('event_passes')
      .select('id,person_id,expires_at,scan_count')
      .eq('token_hash', hashPassToken(token))
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);

    const pass = data as {
      id: string;
      person_id: string;
      expires_at: string | null;
      scan_count: number | null;
    } | null;
    // Same message for "no such token" and "wrong event": a desk cannot act on
    // the difference, and distinguishing them would turn the scanner into an
    // oracle for which tokens exist.
    if (!pass) throw new NotFoundException('pass_not_recognized');
    if (pass.expires_at && new Date(pass.expires_at).getTime() < Date.now()) {
      throw new NotFoundException('pass_expired');
    }

    await this.recordScan(pass.id, pass.scan_count ?? 0);
    return { personId: pass.person_id };
  }

  /**
   * Whose pass is this, for the page an emailed link opens.
   *
   * Reachable without a session — possession of the token IS the credential,
   * exactly as it is for the claim and email-change links. The projection is the
   * security boundary and is deliberately tiny: the name and event already in
   * the recipient's inbox, and nothing else. No club, no schedule, no id.
   *
   * Not event-scoped, because the caller is the fighter and has no event context
   * yet — the token names its own event.
   */
  async preview(rawToken: string): Promise<PassPreview> {
    const token = rawToken.trim();
    if (!looksLikePassToken(token)) throw new NotFoundException('pass_not_recognized');

    const { data, error } = await this.supabase.service
      .from('event_passes')
      .select('expires_at,persons(given_name,family_name),events(name,slug,start_date)')
      .eq('token_hash', hashPassToken(token))
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);

    const row = data as {
      expires_at: string | null;
      persons: { given_name: string; family_name: string } | null;
      events: { name: string; slug: string; start_date: string | null } | null;
    } | null;
    if (!row?.persons || !row.events) throw new NotFoundException('pass_not_recognized');
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      throw new NotFoundException('pass_expired');
    }

    return {
      givenName: row.persons.given_name,
      familyName: row.persons.family_name,
      eventName: row.events.name,
      eventSlug: row.events.slug,
      startDate: row.events.start_date,
    };
  }

  /**
   * A scan is telemetry, never a gate.
   *
   * Failing to record one must not fail the scan the volunteer is standing
   * there waiting for, so the error is swallowed — the same posture the staff
   * heartbeat takes for the same reason.
   */
  private async recordScan(passId: string, scanCount: number): Promise<void> {
    // The result is read and dropped rather than thrown: a failed telemetry
    // write must not fail the scan the volunteer is waiting on.
    await this.supabase.service
      .from('event_passes')
      .update({
        last_scanned_at: new Date().toISOString(),
        scan_count: scanCount + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', passId);
  }

  private async eventEndDate(eventId: string): Promise<string | null> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('end_date')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as { end_date: string | null } | null)?.end_date ?? null;
  }
}
