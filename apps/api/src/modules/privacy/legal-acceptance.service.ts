/**
 * legal-acceptance.service.ts — recording, and checking, agreement to the
 * published terms and privacy policy.
 *
 * Three jobs, in the order they matter:
 *
 * 1. **Refuse a stale acceptance.** The version a client posts is compared to
 *    `LEGAL_POLICIES` here, on the server. A browser running a cached bundle
 *    from before a policy revision would otherwise record agreement to a
 *    document that is no longer published — an acceptance that names the wrong
 *    text is worse than none, because it looks like evidence.
 *
 * 2. **Write the row.** Append-only: re-acceptance inserts, nothing updates.
 *
 * 3. **Answer "what is this user behind on?"** — read on every authenticated
 *    `GET /api/v1/me`, so it is one indexed query and no joins.
 *
 * Lives in PrivacyModule rather than a module of its own because that module
 * deliberately imports nothing, which is what lets AuthModule depend on it
 * without forming a cycle.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_POLICIES,
  isLegalVersionCurrent,
  type LegalDocumentKind,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';

/** The versions a client echoes back when it accepts. */
export interface AcceptedLegalVersions {
  terms: string;
  privacy: string;
}

/** Request provenance kept with the acceptance. Both optional; neither is trusted. */
export interface AcceptanceContext {
  ip?: string | null;
  userAgent?: string | null;
}

interface AcceptanceRow {
  document_kind: string;
  version: string;
  accepted_at: string;
}

export interface LegalAcceptanceSummary {
  kind: LegalDocumentKind;
  version: string;
  acceptedAt: string;
  /** False once the published version has moved on. */
  current: boolean;
}

/** A user agent string long enough to be a payload is not a user agent string. */
const MAX_USER_AGENT = 500;

@Injectable()
export class LegalAcceptanceService {
  private readonly logger = new Logger(LegalAcceptanceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Validate what the client posted, or throw 400. Returns the versions to
   * store — always the registry's, never the client's, so a passing check
   * cannot smuggle a differently-cased or padded string into the record.
   */
  assertCurrent(accepted: Partial<AcceptedLegalVersions> | undefined): AcceptedLegalVersions {
    const stale: LegalDocumentKind[] = [];
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      const posted = accepted?.[kind];
      if (typeof posted !== 'string' || !isLegalVersionCurrent(kind, posted)) {
        stale.push(kind);
      }
    }
    if (stale.length > 0) {
      throw new BadRequestException({
        code: 'legal_version_stale',
        message:
          'The terms or privacy policy have changed. Reload the page and accept the current version.',
        documents: stale,
        // The client needs the current values to retry without a full reload.
        current: this.currentVersions(),
      });
    }
    return this.currentVersions();
  }

  currentVersions(): AcceptedLegalVersions {
    return {
      terms: LEGAL_POLICIES.terms.version,
      privacy: LEGAL_POLICIES.privacy.version,
    };
  }

  /** Record acceptance of every document for an account. */
  async recordForUser(
    userId: string,
    versions: AcceptedLegalVersions,
    context: AcceptanceContext = {},
  ): Promise<void> {
    await this.insert(
      LEGAL_DOCUMENT_KINDS.map((kind) => ({
        user_id: userId,
        guest_session_id: null,
        document_kind: kind,
        version: versions[kind],
        ...this.contextColumns(context),
      })),
    );
  }

  /**
   * Record that a guest was shown the notice. Not a gate: a guest hands over no
   * new personal data — the roster is already the organiser's — so the entry
   * screen informs rather than blocks, and this records that it did. The stored
   * versions are the registry's, because there is no client claim to check.
   */
  async recordForGuestSession(
    guestSessionId: string,
    context: AcceptanceContext = {},
  ): Promise<void> {
    const versions = this.currentVersions();
    await this.insert(
      LEGAL_DOCUMENT_KINDS.map((kind) => ({
        user_id: null,
        guest_session_id: guestSessionId,
        document_kind: kind,
        version: versions[kind],
        ...this.contextColumns(context),
      })),
    );
  }

  /**
   * Which documents has this user not accepted at the published version?
   *
   * Never throws. This is called from `GET /api/v1/me`, the endpoint every
   * surface uses to discover who it is talking to — failing it over a consent
   * banner would take down the whole app to ask a question. A read failure
   * reports "nothing pending" and logs.
   */
  async pendingFor(userId: string): Promise<LegalDocumentKind[]> {
    const rows = await this.latestByKind(userId);
    if (rows === null) return [];
    return LEGAL_DOCUMENT_KINDS.filter((kind) => {
      const row = rows.get(kind);
      return !row || !isLegalVersionCurrent(kind, row.version);
    });
  }

  /** What this user accepted, for the "your agreements" block in settings. */
  async summaryFor(userId: string): Promise<LegalAcceptanceSummary[]> {
    const rows = await this.latestByKind(userId);
    if (rows === null) return [];
    const summary: LegalAcceptanceSummary[] = [];
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      const row = rows.get(kind);
      if (!row) continue;
      summary.push({
        kind,
        version: row.version,
        acceptedAt: row.accepted_at,
        current: isLegalVersionCurrent(kind, row.version),
      });
    }
    return summary;
  }

  /**
   * Latest row per document kind, or `null` when the read itself failed —
   * which callers must not confuse with "this user has accepted nothing".
   */
  private async latestByKind(userId: string): Promise<Map<string, AcceptanceRow> | null> {
    const { data, error } = await this.supabase.service
      .from('legal_acceptances')
      .select('document_kind, version, accepted_at')
      .eq('user_id', userId)
      .order('accepted_at', { ascending: false });

    if (error) {
      this.logger.warn(`legal_acceptances read failed for ${userId}: ${error.message}`);
      return null;
    }

    const latest = new Map<string, AcceptanceRow>();
    for (const row of (data ?? []) as AcceptanceRow[]) {
      // Ordered newest-first, so the first row seen for a kind is its latest.
      if (!latest.has(row.document_kind)) latest.set(row.document_kind, row);
    }
    return latest;
  }

  private contextColumns(context: AcceptanceContext): {
    ip: string | null;
    user_agent: string | null;
  } {
    return {
      ip: context.ip ?? null,
      user_agent: context.userAgent ? context.userAgent.slice(0, MAX_USER_AGENT) : null,
    };
  }

  /**
   * A failed insert must not fail the signup that triggered it — the account
   * exists by the time we get here, and refusing the response would leave the
   * user with an account they were told they do not have. Logged loudly: the
   * row is missing evidence, and `pendingFor` will ask them again on next load,
   * which is the self-healing path.
   */
  private async insert(rows: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.supabase.service.from('legal_acceptances').insert(rows);
    if (error) {
      this.logger.error(`Failed to record legal acceptance: ${error.message}`);
    }
  }
}
