/**
 * erasure.service.ts — GDPR Art. 17, as MyClash defines it.
 *
 * THE POSTURE: erasure removes the person, not the competitor.
 *
 * Published competition results are a public record, so a fighter's NAME stays
 * attached to the brackets, standings and results they appear in — Art. 17(3)
 * provides for exactly this, and a bracket reading "Removed profile a1b2c3" is
 * a wrecked historical document. Everything that identifies them as a private
 * individual goes: contact details, date of birth, photo, biography, social
 * links, device telemetry, and their social graph.
 *
 * Callers who need the stronger guarantee — harassment, safeguarding, a
 * regulator's order — use `anonymiseGlobalPerson`, which additionally replaces
 * the name and rotates the slug. That is a deliberate super-admin action, never
 * the default.
 *
 * This service is the single owner of "what erasure means". AuthService calls
 * it; it must not grow a second, divergent copy there.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import {
  GLOBAL_PERSON_NULLED,
  PERSON_NULLED,
  containmentProbes,
  hashSlug,
  nulls,
  pseudonymFor,
  scrubPii,
  slugFor,
} from './erasure-redaction';

export type RedactionCounts = Record<string, number>;

export interface AnonymiseResult {
  counts: RedactionCounts;
  /** sha256 of the rotated-away slug, so its old URL can answer 410 Gone. */
  previousSlugHash: string | null;
}

@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── Account deletion ────────────────────────────────────────────────────────

  /**
   * Redact everything erasure removes for `uid`, keeping names and results.
   *
   * Runs BEFORE the auth.users row is deleted so a mid-flight failure leaves the
   * account intact and the whole operation retryable. Every step is idempotent.
   */
  async redactSubject(uid: string): Promise<RedactionCounts> {
    const globalPersonIds = await this.idsWhere('global_persons', 'claimed_by_user_id', uid);
    const personIds = await this.idsWhere('persons', 'claimed_by_user_id', uid);

    return {
      // Profile: strip the private individual, keep the competitor.
      global_persons: await this.update('global_persons', 'claimed_by_user_id', uid, {
        ...nulls(GLOBAL_PERSON_NULLED),
        account_deleted_at: new Date().toISOString(),
        claimed_by_user_id: null,
        updated_at: new Date().toISOString(),
      }),
      persons: await this.update('persons', 'claimed_by_user_id', uid, {
        ...nulls(PERSON_NULLED),
        claimed_by_user_id: null,
        claim_status: 'unclaimed',
      }),
      // Device telemetry: no historical value, delete outright.
      guest_sessions: await this.deleteIn('guest_sessions', 'person_id', personIds),
      ...(await this.deleteOwnedRows(uid)),
      // Governance trail: keep the row, scrub the personal values.
      audit_log: await this.redactAuditPayloads(uid, globalPersonIds, personIds),
    };
  }

  /**
   * Rows owned outright by the subject: credentials, pending requests, their
   * outbound social graph and comms preferences. All keyed by a single uid
   * column, so they share one shape.
   */
  private async deleteOwnedRows(uid: string): Promise<RedactionCounts> {
    const OWNED: readonly [table: string, column: string][] = [
      ['global_person_claim_tokens', 'user_id'],
      ['global_person_claim_requests', 'user_id'],
      ['person_email_change_requests', 'user_id'],
      ['follows', 'follower_user_id'],
      ['directory_follows', 'follower_user_id'],
      ['organization_follows', 'follower_user_id'],
      ['notification_preferences', 'user_id'],
      ['push_subscriptions', 'user_id'],
    ];
    const counts: RedactionCounts = {};
    for (const [table, column] of OWNED) {
      counts[table] = await this.deleteWhere(table, column, uid);
    }
    return counts;
  }

  /**
   * Art. 5(2) accountability receipt. Stores a hash, never the uid: retaining an
   * identifier for someone who asked to be forgotten would defeat the exercise,
   * while the hash still answers "was this account erased, and when".
   */
  async recordErasure(
    subjectId: string,
    kind: 'account_deletion' | 'admin_anonymisation',
    counts: RedactionCounts,
    previousSlugHash: string | null = null,
  ): Promise<void> {
    const subjectHash = createHash('sha256').update(subjectId).digest('hex');
    const { error } = await this.supabase.service.from('erasure_log').insert({
      subject_hash: subjectHash,
      kind,
      redacted_tables: counts,
      previous_slug_hash: previousSlugHash,
    });
    // Best-effort: a missing receipt must not strand a completed erasure, but it
    // is a compliance gap, so it is logged loudly rather than swallowed.
    if (error) this.logger.error(`erasure receipt failed (${kind}): ${error.message}`);
  }

  // ── Super-admin anonymisation ───────────────────────────────────────────────

  /**
   * The escape hatch: everything `redactSubject` does, plus replacing the name
   * and rotating the slug so the person is no longer identifiable from the
   * public record at all.
   *
   * Slug rotation deliberately breaks old URLs — that is the point when the
   * problem is a cached search result carrying the name. No old→new mapping is
   * kept: such a table would store the identifying slug forever.
   */
  async anonymiseGlobalPerson(globalPersonId: string): Promise<AnonymiseResult> {
    const counts: RedactionCounts = {};
    const pseudonym = pseudonymFor(globalPersonId);

    // Capture the outgoing slug BEFORE the update, so the old public URL can
    // answer 410 Gone. Only its hash is kept — the slug embeds the name.
    // Returned rather than stashed on the instance: this is a singleton, and a
    // field would race between concurrent anonymisations.
    const { data: existing } = await this.supabase.service
      .from('global_persons')
      .select('slug')
      .eq('id', globalPersonId)
      .maybeSingle();
    const previousSlug = (existing as { slug?: string } | null)?.slug ?? null;

    counts['global_persons'] = await this.update('global_persons', 'id', globalPersonId, {
      ...nulls(GLOBAL_PERSON_NULLED),
      display_name: pseudonym,
      given_name: pseudonym,
      family_name: '',
      slug: slugFor(globalPersonId),
      account_deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const personIds = await this.idsWhere('persons', 'global_person_id', globalPersonId);
    counts['persons'] = await this.update('persons', 'global_person_id', globalPersonId, {
      ...nulls(PERSON_NULLED),
      given_name: pseudonym,
      family_name: '',
    });
    counts['guest_sessions'] = await this.deleteIn('guest_sessions', 'person_id', personIds);

    return { counts, previousSlugHash: previousSlug ? hashSlug(previousSlug) : null };
  }

  /**
   * True when `slug` was rotated away by an anonymisation, so the public
   * fighter route can answer 410 Gone rather than a bare 404.
   *
   * 410 is the correct semantic for intentionally-removed content and search
   * engines drop it faster than a 404 — which is the point when the reason for
   * anonymising was a cached result carrying the person's name.
   */
  async isRetiredSlug(slug: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('erasure_log')
      .select('id')
      .eq('previous_slug_hash', hashSlug(slug))
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  }

  // ── Audit payload redaction ─────────────────────────────────────────────────

  /**
   * Scrub the subject's personal values out of audit payloads, keeping the row,
   * its action, entity and timestamp so the governance trail stays intact.
   *
   * Candidate rows are found three ways: the subject as actor, the subject as
   * the row's entity, and containment matches for their ids nested inside a
   * payload. That last set is bounded by a documented key list rather than an
   * unindexable scan for a value at any key — the GIN index added in 0161 makes
   * each containment probe cheap.
   */
  private async redactAuditPayloads(
    uid: string,
    globalPersonIds: string[],
    personIds: string[],
  ): Promise<number> {
    const rows = await this.findAuditRowsAbout(uid, globalPersonIds, personIds);

    let redacted = 0;
    for (const row of rows.values()) {
      const original = row['payload_json'];
      if (original === null || original === undefined) continue;
      const scrubbed = scrubPii(original, 0);
      // Skip the write when nothing changed, so untouched payloads keep their
      // original bytes rather than being rewritten by a no-op update.
      if (JSON.stringify(scrubbed) === JSON.stringify(original)) continue;
      const { error } = await this.supabase.service
        .from('audit_log')
        .update({ payload_json: scrubbed })
        .eq('id', row['id'] as string);
      if (error) {
        this.logger.error(`audit redaction failed for ${String(row['id'])}: ${error.message}`);
        continue;
      }
      redacted += 1;
    }
    return redacted;
  }

  /** Candidate audit rows, deduped by id across the three lookup strategies. */
  private async findAuditRowsAbout(
    uid: string,
    globalPersonIds: string[],
    personIds: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const rows = new Map<string, Record<string, unknown>>();
    const absorb = (data: unknown): void => {
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        rows.set(String(row['id']), row);
      }
    };
    const query = () => this.supabase.service.from('audit_log').select('id, action, payload_json');

    const { data: byActor } = await query().eq('actor_user_id', uid);
    absorb(byActor);

    const { data: byEntity } = await query().in('entity_id', [
      uid,
      ...globalPersonIds,
      ...personIds,
    ]);
    absorb(byEntity);

    for (const probe of containmentProbes(uid, globalPersonIds, personIds)) {
      const { data } = await query().contains('payload_json', probe);
      absorb(data);
    }
    return rows;
  }

  // ── Supabase helpers ────────────────────────────────────────────────────────

  private async idsWhere(table: string, column: string, value: string): Promise<string[]> {
    const { data, error } = await this.supabase.service.from(table).select('id').eq(column, value);
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  private async update(
    table: string,
    column: string,
    value: string,
    patch: Record<string, unknown>,
  ): Promise<number> {
    const { data, error } = await this.supabase.service
      .from(table)
      .update(patch)
      .eq(column, value)
      .select('id');
    if (error) throw new Error(`redact ${table}: ${error.message}`);
    return (data ?? []).length;
  }

  private async deleteWhere(table: string, column: string, value: string): Promise<number> {
    const { data, error } = await this.supabase.service
      .from(table)
      .delete()
      .eq(column, value)
      .select('id');
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    return (data ?? []).length;
  }

  private async deleteIn(table: string, column: string, values: string[]): Promise<number> {
    if (values.length === 0) return 0;
    const { data, error } = await this.supabase.service
      .from(table)
      .delete()
      .in(column, values)
      .select('id');
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    return (data ?? []).length;
  }
}
