/**
 * subject-export.service.ts — GDPR Art. 15 (access) + Art. 20 (portability).
 *
 * Builds the "download everything you hold about me" bundle: a zip of one JSON
 * or CSV entry per subject area, plus a manifest carrying row counts so the
 * export is verifiable rather than merely plausible.
 *
 * The table list is NOT hand-written here. It is driven off SUBJECT_EXPORT_TABLES,
 * which `subject-export.coverage.test.ts` forces to stay complete as migrations
 * land. Adding a query here for a table missing from that map is a bug: the map
 * is the contract, this file is its executor.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createStoredZip } from '../../common/stored-zip';
import { SupabaseService } from '../supabase/supabase.service';
import {
  SUBJECT_EXPORT_TABLES,
  type SubjectReach,
  type SubjectTableSpec,
} from './subject-export.tables';
import { scrubPii } from './erasure-redaction';

/** PostgREST refuses absurd `in` lists; chunk anchor ids well under any limit. */
const ID_CHUNK = 200;

/**
 * The subject's identifiers, resolved once and reused for every table.
 *
 * Keeping the three apart is the whole ballgame — see the SubjectReach docblock
 * in ./subject-export.tables. A persons.id used as a uid silently exports
 * another person's rows.
 */
export interface SubjectAnchors {
  uid: string;
  globalPersonIds: string[];
  personIds: string[];
  /** Registrations belonging to the subject — the bridge to their own matches. */
  registrationIds: string[];
  /** Matches the subject fought in, refereed or scored. */
  matchIds: string[];
}

interface BundleFile {
  rows: Record<string, unknown>[];
  tables: string[];
}

@Injectable()
export class SubjectExportService {
  private readonly logger = new Logger(SubjectExportService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── Public entry point ──────────────────────────────────────────────────────

  async buildBundle(uid: string): Promise<{ filename: string; buffer: Buffer }> {
    const anchors = await this.resolveAnchors(uid);
    const files = new Map<string, BundleFile>();

    for (const [table, spec] of Object.entries(SUBJECT_EXPORT_TABLES)) {
      const rows = await this.fetchDirect(table, spec, anchors);
      this.addRows(files, spec.file, table, table === 'audit_log' ? scrubRows(rows) : rows);
    }

    // Rows that reach the subject through a match or registration rather than
    // through a column on the row itself. Without these the export omits the
    // one thing a competitor actually cares about: their own fights.
    this.addRows(files, 'matches.csv', 'matches', await this.fetchOwnMatches(anchors));
    for (const table of ['match_events', 'match_penalties', 'match_forfeits'] as const) {
      const file =
        table === 'match_events'
          ? 'exchanges.csv'
          : table === 'match_penalties'
            ? 'penalties.csv'
            : 'matches.csv';
      this.addRows(files, file, table, await this.fetchByMatch(table, anchors));
    }

    return this.pack(uid, anchors, files);
  }

  // ── Anchor resolution ───────────────────────────────────────────────────────

  private async resolveAnchors(uid: string): Promise<SubjectAnchors> {
    const globalPersonIds = await this.idsWhere('global_persons', 'claimed_by_user_id', uid);
    const personIds = await this.idsWhere('persons', 'claimed_by_user_id', uid);

    // A person row may be linked to the subject's global identity without
    // carrying the claim itself (organiser-created roster rows resolved by the
    // GlobalPersonResolver). Those events are still the subject's.
    for (const chunk of chunked(globalPersonIds)) {
      const { data, error } = await this.supabase.service
        .from('persons')
        .select('id')
        .in('global_person_id', chunk);
      if (error) throw new Error(`persons by global_person_id: ${error.message}`);
      for (const row of (data ?? []) as { id: string }[]) personIds.push(row.id);
    }

    const uniquePersonIds = [...new Set(personIds)];
    const registrationIds = await this.idsIn('registrations', 'person_id', uniquePersonIds);
    const matchIds = await this.resolveMatchIds(uid, uniquePersonIds, registrationIds);

    return {
      uid,
      globalPersonIds: [...new Set(globalPersonIds)],
      personIds: uniquePersonIds,
      registrationIds,
      matchIds,
    };
  }

  private async resolveMatchIds(
    uid: string,
    personIds: string[],
    registrationIds: string[],
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const column of ['red_registration_id', 'blue_registration_id'] as const) {
      for (const id of await this.idsIn('matches', column, registrationIds)) ids.add(id);
    }
    for (const id of await this.idsIn('matches', 'referee_id', personIds)) ids.add(id);
    for (const id of await this.idsWhere('matches', 'scorekeeper_user_id', uid)) ids.add(id);
    return [...ids];
  }

  // ── Row fetching ────────────────────────────────────────────────────────────

  /** Rows whose own columns point at the subject. */
  private async fetchDirect(
    table: string,
    spec: SubjectTableSpec,
    anchors: SubjectAnchors,
  ): Promise<Record<string, unknown>[]> {
    const collected: Record<string, unknown>[] = [];
    for (const { column, reach } of spec.reaches) {
      const values = this.anchorValues(reach, anchors);
      if (values.length === 0) continue;
      for (const chunk of chunked(values)) {
        const { data, error } = await this.supabase.service
          .from(table)
          .select('*')
          .in(column, chunk);
        if (error) {
          // A wrong column name 400s the whole query and would otherwise vanish
          // into an empty export that looks complete.
          throw new Error(`subject export ${table}.${column}: ${error.message}`);
        }
        collected.push(...((data ?? []) as Record<string, unknown>[]));
      }
    }
    return collected;
  }

  /** The subject's own matches — reached through their registrations. */
  private async fetchOwnMatches(anchors: SubjectAnchors): Promise<Record<string, unknown>[]> {
    return this.rowsIn('matches', 'id', anchors.matchIds);
  }

  /** Exchanges / penalties / forfeits belonging to the subject's matches. */
  private async fetchByMatch(
    table: string,
    anchors: SubjectAnchors,
  ): Promise<Record<string, unknown>[]> {
    return this.rowsIn(table, 'match_id', anchors.matchIds);
  }

  private anchorValues(reach: SubjectReach, anchors: SubjectAnchors): string[] {
    if (reach === 'uid') return [anchors.uid];
    if (reach === 'global_person') return anchors.globalPersonIds;
    return anchors.personIds;
  }

  // ── Supabase helpers ────────────────────────────────────────────────────────

  private async idsWhere(table: string, column: string, value: string): Promise<string[]> {
    const { data, error } = await this.supabase.service.from(table).select('id').eq(column, value);
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  private async idsIn(table: string, column: string, values: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const chunk of chunked(values)) {
      const { data, error } = await this.supabase.service
        .from(table)
        .select('id')
        .in(column, chunk);
      if (error) throw new Error(`${table}.${column}: ${error.message}`);
      ids.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
    }
    return [...new Set(ids)];
  }

  private async rowsIn(
    table: string,
    column: string,
    values: string[],
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const chunk of chunked(values)) {
      const { data, error } = await this.supabase.service.from(table).select('*').in(column, chunk);
      if (error) throw new Error(`${table}.${column}: ${error.message}`);
      rows.push(...((data ?? []) as Record<string, unknown>[]));
    }
    return rows;
  }

  // ── Bundle assembly ─────────────────────────────────────────────────────────

  private addRows(
    files: Map<string, BundleFile>,
    file: string,
    table: string,
    rows: Record<string, unknown>[],
  ): void {
    if (rows.length === 0) return;
    const entry = files.get(file) ?? { rows: [], tables: [] };
    // Tag each row so a merged CSV stays readable, and dedupe: a row can be
    // reached by more than one column (a referee who also scorekeeps).
    const seen = new Set(entry.rows.map(stableKey));
    for (const row of rows) {
      const tagged = { _table: table, ...row };
      const key = stableKey(tagged);
      if (seen.has(key)) continue;
      seen.add(key);
      entry.rows.push(tagged);
    }
    if (!entry.tables.includes(table)) entry.tables.push(table);
    files.set(file, entry);
  }

  private pack(
    uid: string,
    anchors: SubjectAnchors,
    files: Map<string, BundleFile>,
  ): { filename: string; buffer: Buffer } {
    const generatedAt = new Date().toISOString();
    const entries: Record<string, string> = { 'README.txt': README };
    const manifest: Record<string, unknown> = {
      generatedAt,
      schemaVersion: 1,
      subject: {
        // The subject's own uid is theirs to see; the linked identities let them
        // make sense of rows keyed by a person id rather than a name.
        userId: uid,
        globalPersonIds: anchors.globalPersonIds,
        personIds: anchors.personIds,
      },
      files: {} as Record<string, { tables: string[]; rowCount: number }>,
    };

    for (const [name, file] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      entries[name] = name.endsWith('.json')
        ? JSON.stringify(file.rows, null, 2)
        : rowsToCsv(file.rows);
      (manifest['files'] as Record<string, unknown>)[name] = {
        tables: file.tables,
        rowCount: file.rows.length,
      };
    }

    entries['manifest.json'] = JSON.stringify(manifest, null, 2);

    const stamp = generatedAt.slice(0, 10);
    this.logger.log(`subject export built for ${uid}: ${Object.keys(entries).length} entries`);
    return {
      filename: `myclash-data-export-${stamp}.zip`,
      buffer: createStoredZip(entries),
    };
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function* chunked(values: string[]): Generator<string[]> {
  for (let index = 0; index < values.length; index += ID_CHUNK) {
    yield values.slice(index, index + ID_CHUNK);
  }
}

/** Dedupe key. Rows without an `id` (person_privacy) fall back to full content. */
function stableKey(row: Record<string, unknown>): string {
  const id = row['id'];
  return typeof id === 'string' ? `${String(row['_table'])}:${id}` : JSON.stringify(row);
}

/**
 * CSV over a heterogeneous row set: the header is the union of every key seen,
 * so merging two tables into one file cannot silently drop a column that only
 * one of them has.
 *
 * NOT ../exports/hema-ratings-format#toCsv, despite the overlap: that one ships
 * `HEADER_ROW = false` because HEMA Ratings' own importer wants a headerless
 * file. Reusing it here would silently strip the header from every file in this
 * bundle and make the export unreadable. Do not consolidate the two.
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  const header: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!header.includes(key)) header.push(key);
  }
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvCell(serialize(row[key]))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Scrub personal fields out of exported audit payloads.
 *
 * These rows are the actions the SUBJECT took, but an organiser's payload can
 * embed a third party's contact details — the whole roster row they edited.
 * Art. 15(4): the right to a copy must not adversely affect the rights of
 * others. The action, entity and timestamp survive, so the subject still gets a
 * complete record of what they did.
 */
export function scrubRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    row['payload_json'] === null || row['payload_json'] === undefined
      ? row
      : { ...row, payload_json: scrubPii(row['payload_json'], 0) },
  );
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Leading =, +, - and @ make Excel and LibreOffice treat a cell as a formula.
 * This bundle carries free text written by OTHER people — an organiser's `notes`
 * on a roster row, an audit payload — so a planted `=cmd|...` would execute when
 * the data subject opens their own export. Prefixing with a single quote makes
 * the cell literal text; spreadsheet apps strip the quote on display.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const safe = CSV_FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const README = `MyClash — your personal data export
===================================

This archive contains the personal data MyClash holds about you, provided under
your right of access (GDPR Art. 15) and right to data portability (Art. 20).

manifest.json lists every file, the database tables it came from, and how many
rows each contains. Every row carries a "_table" column naming its source.

WHAT IS NOT HERE
----------------
- Other people's data. Who follows you, and decisions other people made about
  your requests, identify them rather than you (Art. 15(4)).
- Credentials. Password hashes, API keys and one-time tokens are not disclosed:
  they say nothing about you and disclosing them would weaken your account.
- Events, rulesets and other organisation records you created. Those belong to
  the organisation; audit.csv records the actions you took on them.

Questions about this export can go to the address in the privacy policy.
`;
