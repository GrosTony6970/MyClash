import { Injectable, Logger } from '@nestjs/common';
import { zonedDay } from '@myclash/time';
import type { FightBookQrCode, SparKind } from '@myclash/types';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { hashPassToken, mintPassToken } from '../checkin/pass-token';
import { SupabaseService } from '../supabase/supabase.service';
import { floorEvent } from './floor-event';
import {
  badRequest,
  catalogWeapons,
  onFreeDate,
  sparExpiresAt,
  type SparWhere,
} from './spar-ask-rules';
import { notifySparRequestReceived, type SparNoticeDeps } from './spar-notices';
import { SPAR_REFUSAL_SENTENCES } from './spar-refusal-sentences';
import { databaseRefusal } from './spar-requests.service';

/** What a FightBook QR encodes before its secret. The desk's pass reader refuses it (`:`). */
export const QR_CODE_PREFIX = 'fb:';

/**
 * 400 `bad_event` for a scan at an Event: the database's refusal word for word (Decision 14), so
 * not even the raw answer tells whether the scanner or the shower is off the Event.
 */
const offTheScanFloor = () => badRequest('bad_event', SPAR_REFUSAL_SENTENCES.bad_event);

/** How long a code works (ruling 711). */
export const QR_CODE_LIFETIME_MS = 5 * 60_000;

/** A scan, as the route's body carries it: an Event the scanner is at, or a place and a zone. */
export interface QrScanInput {
  code: string;
  weapons: string[];
  eventId?: string;
  place?: string;
  zone?: string;
}

/** Where a scanned spar happens, and its day: today, at an Event or at a place. */
interface ScanWhere extends SparWhere {
  kind: SparKind;
  day: string;
}

/** Elsewhere (ruling 709): today on the phone's clock, at the place typed. */
function freeToday(input: QrScanInput, now: Date): ScanWhere {
  const where = onFreeDate(input);
  // `onFreeDate` refused a zone with no day (`bad_zone`), so a null here is a broken invariant.
  const day = zonedDay(now.toISOString(), where.zone);
  if (!day) throw new Error(`QR scan zone ${where.zone} has no readable day`);
  return { ...where, kind: 'free', day };
}

/**
 * "My FightBook QR" and the scan that logs a spar by it (FightBook slice 5, Decisions 11-13,
 * rulings 707, 709, 711, 713, 714). The shower's code is one scan for five minutes; a scan writes
 * a waiting spar request from the scanner to her, which she answers in her Inbox. The rules that
 * must win a race (one scan per code, the pair's rules) live in `fightbook_qr_log` (0270).
 */
@Injectable()
export class SparQrService {
  private readonly logger = new Logger(SparQrService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  /**
   * A new code for my QR. Every code of mine but the newest live one is deleted first: a scan
   * begun on the code still on screen works until it ends, and at most two of mine are live (two
   * mints at the same instant can leave three for minutes; accepted, Decision 11). Only the hash
   * of the secret is stored; the code is answered once, here.
   */
  async mint(me: string, now = new Date()): Promise<FightBookQrCode> {
    const db = this.supabase.service;
    const keep = await this.newestLiveCode(me, now);
    let stale = db.from('fightbook_qr_codes').delete().eq('global_person_id', me);
    if (keep) stale = stale.neq('id', keep);
    const { error: staleError } = await stale;
    if (staleError) throw new Error(`FightBook QR clean-up failed: ${staleError.message}`);
    const secret = mintPassToken();
    const expiresAt = new Date(now.getTime() + QR_CODE_LIFETIME_MS).toISOString();
    const { error } = await db
      .from('fightbook_qr_codes')
      .insert({ token_hash: hashPassToken(secret), global_person_id: me, expires_at: expiresAt });
    if (error) throw new Error(`FightBook QR mint failed: ${error.message}`);
    return { code: `${QR_CODE_PREFIX}${secret}`, expiresAt };
  }

  /**
   * Log a spar by the code a fighter shows: a request from me to her, today, at the Event we are
   * both at or at a place I type. Refused before the code is spent: no `fb:` (`bad_code`, before
   * any read), the Event (`bad_event`), the place and zone, the weapons. Answers `{ id }` only,
   * whatever she decided about me: the notice is started, not awaited, and only when the
   * database says she did not block me, so a blocked scan answers the same and as fast (714).
   */
  async scan(me: string, input: QrScanInput, now = new Date()): Promise<{ id: string }> {
    if (!input.code.startsWith(QR_CODE_PREFIX)) {
      throw badRequest('bad_code', 'This is not a FightBook code');
    }
    const db = this.supabase.service;
    const where = input.eventId
      ? await this.atEvent(me, input.eventId, now)
      : freeToday(input, now);
    const weapons = await catalogWeapons(db, input.weapons);
    const expires = sparExpiresAt(where.kind, where.day, where.zone);
    if (!expires) throw new Error(`FightBook scan: no end for ${where.day} in ${where.zone}`);
    const { data, error } = await db.rpc('fightbook_qr_log', {
      p_token_hash: hashPassToken(input.code.slice(QR_CODE_PREFIX.length)),
      p_scanner: me,
      p_kind: where.kind,
      p_event_id: where.eventId,
      p_spar_day: where.day,
      p_zone: where.zone,
      p_place: where.place,
      p_weapons: weapons,
      p_expires_at: expires.toISOString(),
    });
    if (error) throw databaseRefusal(error, 'spar QR log');
    const logged = data as { id: string; notify: boolean };
    if (logged.notify) void this.tellShower(logged.id);
    return { id: logged.id };
  }

  /** My newest code still live, if any. */
  private async newestLiveCode(me: string, now: Date): Promise<string | null> {
    const { data, error } = await this.supabase.service
      .from('fightbook_qr_codes')
      .select('id')
      .eq('global_person_id', me)
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`FightBook QR codes read failed: ${error.message}`);
    return (data as { id: string } | null)?.id ?? null;
  }

  /** At an Event (ruling 709): public, I am on its roster, a day of it runs now; else `bad_event`. */
  private async atEvent(me: string, eventId: string, now: Date): Promise<ScanWhere> {
    const db = this.supabase.service;
    const { today, zone } = await floorEvent(db, me, eventId, now, offTheScanFloor);
    if (!today) throw offTheScanFloor();
    return { kind: 'event', day: today, eventId, zone, place: null };
  }

  /**
   * "New request", to the fighter whose code was scanned. The database answers the request's id
   * only, so her profile is read from it here, inside the send the route does not wait for.
   * Never throws: a failed read is logged and nothing is sent.
   */
  private async tellShower(requestId: string): Promise<void> {
    const deps = this.noticeDeps();
    try {
      const { data, error } = await deps.db
        .from('spar_requests')
        .select('receiver_global_person_id')
        .eq('id', requestId)
        .maybeSingle();
      if (error) throw new Error(`request unreadable: ${error.message}`);
      const shower = (data as { receiver_global_person_id: string } | null)
        ?.receiver_global_person_id;
      if (!shower) throw new Error('request not found');
      await notifySparRequestReceived(deps, requestId, shower);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`FightBook spar_request_received of ${requestId} was not sent: ${reason}`);
    }
  }

  private noticeDeps(): SparNoticeDeps {
    return {
      db: this.supabase.service,
      notifications: this.notifications,
      supabase: this.supabase,
      logger: this.logger,
    };
  }
}
