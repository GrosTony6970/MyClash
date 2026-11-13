import { describe, expect, it } from 'vitest';
import { SUBJECT_EXPORT_EXCLUDED_TABLES, SUBJECT_EXPORT_TABLES } from './subject-export.tables';

describe('the FightBook floor tables in the subject export', () => {
  it.each([
    ['fightbook_free_now', 'global_person_id'],
    ['fightbook_daily_limits', 'global_person_id'],
    ['spar_open_calls', 'poster_global_person_id'],
    ['spar_open_call_answers', 'answerer_global_person_id'],
  ])('exports %s by %s only, so a poster never reads who answered', (table, column) => {
    expect(SUBJECT_EXPORT_TABLES[table]?.reaches).toEqual([{ column, reach: 'global_person' }]);
  });

  it('leaves the QR code hashes out, with the census still keeping them apart', () => {
    expect(SUBJECT_EXPORT_EXCLUDED_TABLES.has('fightbook_qr_codes')).toBe(true);
    expect(SUBJECT_EXPORT_TABLES['fightbook_qr_codes']).toBeUndefined();
  });
});
