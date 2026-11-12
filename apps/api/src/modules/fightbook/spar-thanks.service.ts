import { Injectable } from '@nestjs/common';
import type { ThanksPage, ThankYou } from '@myclash/types';
import { inListChunks } from '../../common/postgrest-in-list';
import { SupabaseService } from '../supabase/supabase.service';
import { readSparEventNames, readSparFighters, unknownSparFighter } from './spar-fighters';
import { sparWhen, NO_EXTRAS, type SparCardExtras, type SparRow } from './spar-views';

/** Thank-yous per page of the list (Decision 9). */
const THANKS_PAGE_SIZE = 20;

type Written = { spar_request_id: string; stars: number; body?: string | null };
type ThanksRow = {
  id: string;
  spar_request_id: string;
  author_global_person_id: string;
  stars: number;
  body: string | null;
};
type WhenRow = Pick<
  SparRow,
  'id' | 'kind' | 'event_id' | 'spar_day' | 'spar_time' | 'place' | 'weapons'
>;
type Answer = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * What was written after a spar (FightBook slice 3), as the caller may read it. Every read names
 * the caller in its filter. An anonymous review is read only by its author: it never reaches its
 * subject's card or list, so it cannot name its writer (the subject's card is the same with or
 * without it).
 */
@Injectable()
export class SparThanksService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * For each spar card, the caller's own thank-you or anonymous review, the partner's SIGNED
   * thank-you to the caller, and the caller's private note. Four reads per 200 spars. Each table
   * holds one row per (spar, author), so no read passes one row per spar: the spar lists cap it.
   */
  async cardExtras(me: string, requestIds: string[]): Promise<Map<string, SparCardExtras>> {
    const ids = [...new Set(requestIds)];
    const db = this.supabase.service;
    const [mine, myAnonymous, theirs, notes] = await Promise.all([
      byRequest<Written>(ids, (piece) =>
        db
          .from('spar_thanks')
          .select('spar_request_id, stars, body')
          .eq('author_global_person_id', me)
          .in('spar_request_id', piece),
      ),
      byRequest<Written>(ids, (piece) =>
        db
          .from('spar_anonymous_reviews')
          .select('spar_request_id, stars')
          .eq('author_global_person_id', me)
          .in('spar_request_id', piece),
      ),
      byRequest<Written>(ids, (piece) =>
        db
          .from('spar_thanks')
          .select('spar_request_id, stars, body')
          .eq('subject_global_person_id', me)
          .in('spar_request_id', piece),
      ),
      byRequest<{ spar_request_id: string; body: string }>(ids, (piece) =>
        db
          .from('spar_private_notes')
          .select('spar_request_id, body')
          .eq('author_global_person_id', me)
          .in('spar_request_id', piece),
      ),
    ]);
    const extras = new Map<string, SparCardExtras>();
    const on = (id: string): SparCardExtras => {
      const card = extras.get(id) ?? { ...NO_EXTRAS };
      extras.set(id, card);
      return card;
    };
    for (const r of myAnonymous) on(r.spar_request_id).myReview = review(r, true);
    for (const r of mine) on(r.spar_request_id).myReview = review(r, false);
    for (const r of theirs) {
      on(r.spar_request_id).theirThanks = { stars: r.stars, text: r.body ?? null };
    }
    for (const r of notes) on(r.spar_request_id).note = r.body;
    return extras;
  }

  /**
   * One page of the signed thank-yous the caller received, newest first (then by id), with who
   * wrote each and the spar's when and where. 20 a page and one more row, which only says there
   * is more. The write side is bounded by one thank-you per author per spar.
   */
  async received(me: string, page: number): Promise<ThanksPage> {
    const from = page * THANKS_PAGE_SIZE;
    const { data, error } = await this.supabase.service
      .from('spar_thanks')
      .select('id, spar_request_id, author_global_person_id, stars, body')
      .eq('subject_global_person_id', me)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + THANKS_PAGE_SIZE);
    if (error) throw new Error(`FightBook thank-yous read failed: ${error.message}`);
    const rows = (data ?? []) as ThanksRow[];
    const shown = rows.slice(0, THANKS_PAGE_SIZE);
    const items = await this.thankYous(shown);
    return { items, more: rows.length > THANKS_PAGE_SIZE };
  }

  /** The rows as the list shows them: the author's card, and the spar's when and where. */
  private async thankYous(rows: ThanksRow[]): Promise<ThankYou[]> {
    const db = this.supabase.service;
    const [spars, people] = await Promise.all([
      this.sparsOf([...new Set(rows.map((r) => r.spar_request_id))]),
      readSparFighters(
        db,
        rows.map((r) => r.author_global_person_id),
      ),
    ]);
    const eventIds = [...spars.values()].flatMap((s) => (s.event_id ? [s.event_id] : []));
    const events = await readSparEventNames(db, [...new Set(eventIds)]);
    return rows.flatMap((r) => {
      const spar = spars.get(r.spar_request_id);
      if (!spar) return []; // the spar was deleted between the two reads, and its thanks with it
      const author = r.author_global_person_id;
      return [
        {
          id: r.id,
          from: people.get(author) ?? unknownSparFighter(author),
          ...sparWhen(spar, spar.event_id ? (events.get(spar.event_id) ?? null) : null),
          stars: r.stars,
          text: r.body,
        },
      ];
    });
  }

  /** The spars a page of thank-yous is on, by id: at most 20, one read. */
  private async sparsOf(ids: string[]): Promise<Map<string, WhenRow>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select('id, kind, event_id, spar_day, spar_time, place, weapons')
      .in('id', ids);
    if (error) throw new Error(`FightBook thank-you spars read failed: ${error.message}`);
    return new Map(((data ?? []) as WhenRow[]).map((s) => [s.id, s]));
  }
}

const review = (row: Written, anonymous: boolean) => ({
  stars: row.stars,
  text: anonymous ? null : (row.body ?? null),
  anonymous,
});

/** One read per piece of at most 200 spar ids; none for no ids. */
async function byRequest<T>(ids: string[], read: (piece: string[]) => Answer): Promise<T[]> {
  const rows: T[] = [];
  for (const piece of inListChunks(ids)) {
    const { data, error } = await read(piece);
    if (error) throw new Error(`FightBook spar card read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}
