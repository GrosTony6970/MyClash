import { describe, expect, it } from 'vitest';
import { rowsToCsv, scrubRows } from './subject-export.service';
import { HEADER_ROW } from '../exports/hema-ratings-format';
import { SUBJECT_EXPORT_TABLES, SUBJECT_EXPORT_EXCLUDED_TABLES } from './subject-export.tables';

describe('rowsToCsv', () => {
  it('unions the header across heterogeneous rows', () => {
    // Several tables share one bundle file, so a header taken from the first
    // row alone would silently drop the other table's columns.
    const csv = rowsToCsv([
      { _table: 'a', x: 1 },
      { _table: 'b', y: 2 },
    ]);
    expect(csv.split('\n')[0]).toBe('_table,x,y');
    expect(csv).toContain('a,1,');
    expect(csv).toContain('b,,2');
  });

  it('quotes cells containing separators, quotes or newlines', () => {
    const csv = rowsToCsv([{ notes: 'a,b "c"\nd' }]);
    expect(csv).toContain('"a,b ""c""\nd"');
  });

  it('renders null and undefined as empty, not as the string "null"', () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: 0 }]);
    expect(csv.trim().split('\n')[1]).toBe(',,0');
  });

  it('serialises nested objects as JSON rather than [object Object]', () => {
    const csv = rowsToCsv([{ payload: { nested: true } }]);
    expect(csv).toContain('{""nested"":true}');
  });

  it('neutralises spreadsheet formulas planted by someone else', () => {
    // `notes` on a roster row is written by an ORGANISER, not the subject, so a
    // planted formula would execute when the subject opens their own export.
    for (const lead of ['=', '+', '-', '@']) {
      const csv = rowsToCsv([{ notes: `${lead}cmd|' /c calc'!A1` }]);
      expect(csv, lead).toContain(`'${lead}cmd`);
    }
  });

  it('always emits a header row, unlike the HEMA Ratings exporter', () => {
    // Guards the reason rowsToCsv is not toCsv: that one ships HEADER_ROW=false
    // because HEMA Ratings' importer wants a headerless file. Consolidating them
    // would silently strip the header from every file in this bundle.
    expect(HEADER_ROW).toBe(false);
    expect(rowsToCsv([{ a: 1 }]).split('\n')[0]).toBe('a');
  });
});

describe('scrubRows (exported audit payloads)', () => {
  it('removes a third party’s contact details from the subject’s own audit rows', () => {
    // Art. 15(4): the subject's copy must not adversely affect others' rights.
    // An organiser's payload embeds the whole roster row they edited.
    const [row] = scrubRows([
      {
        id: 'a1',
        action: 'person.update',
        payload_json: { person: { given_name: 'Jean', email: 'other@example.com' } },
      },
    ]);
    const person = (row!['payload_json'] as { person: Record<string, unknown> }).person;

    expect(person['email']).toBe('[redacted]');
    // The action record stays intelligible: names are public-record data here.
    expect(person['given_name']).toBe('Jean');
    expect(row!['action']).toBe('person.update');
  });

  it('leaves a payload-free audit row untouched', () => {
    const [row] = scrubRows([{ id: 'a1', action: 'login', payload_json: null }]);
    expect(row!['payload_json']).toBeNull();
  });
});

describe('subject table census', () => {
  it('treats workshop_enrollments.user_id as a persons.id, not an auth uid', () => {
    // THE trap. Guests carry a persons.id with no account, so reading this as a
    // uid exports nothing — and reading some other persons.id as a uid would
    // export a different person's rows. Both failures are silent.
    const reach = SUBJECT_EXPORT_TABLES['workshop_enrollments']?.reaches.find(
      (r) => r.column === 'user_id',
    );
    expect(reach?.reach).toBe('person');
  });

  it('reaches league standing through the legacy fighter_id column name', () => {
    // `fighters` became `global_persons` in 0023, but these two columns kept the
    // old NAME while their siblings were renamed.
    for (const table of ['league_rankings', 'league_tournament_results']) {
      const reaches = SUBJECT_EXPORT_TABLES[table]?.reaches;
      expect(reaches?.[0]?.column, `${table}`).toBe('fighter_id');
      expect(reaches?.[0]?.reach).toBe('global_person');
    }
  });

  it('reaches the assigned referee through matches.referee_id', () => {
    // Named neither *_user_id nor *_person_id — found only because the coverage
    // guard scans foreign keys as well as column names.
    const reach = SUBJECT_EXPORT_TABLES['matches']?.reaches.find((r) => r.column === 'referee_id');
    expect(reach?.reach).toBe('person');
  });

  it('never exports credential material', () => {
    for (const table of [
      'global_person_claim_tokens',
      'admin_user_temp_passwords',
      'fighter_ai_keys',
      'organization_ai_keys',
      'platform_ai_keys',
    ]) {
      expect(SUBJECT_EXPORT_EXCLUDED_TABLES.has(table), `${table} must not be exported`).toBe(true);
      expect(SUBJECT_EXPORT_TABLES[table]).toBeUndefined();
    }
  });

  it('does not treat inbound follows as the subject’s own data', () => {
    // Who follows the subject identifies OTHER people — Art. 15(4).
    const columns = SUBJECT_EXPORT_TABLES['follows']?.reaches.map((r) => r.column) ?? [];
    expect(columns).toContain('follower_user_id');
    expect(columns).not.toContain('followed_person_id');
  });

  it('exports the subject’s league standing even though the archive excludes it', () => {
    // Different question, different answer: cross-event and recomputed for an
    // event archive, but unambiguously about the person for a subject request.
    expect(SUBJECT_EXPORT_TABLES['league_rankings']).toBeDefined();
  });
});
