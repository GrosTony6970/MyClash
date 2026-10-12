/**
 * The search of the penalty list is emptied by a card written on the tablet
 * (quick win P15). The live proof is `tests/a11y/pad-penalty-search.spec.ts`;
 * this pins WHERE the field is emptied, which decides the cases a story cannot
 * all reach: a quick-pick card, a yellow card, the yes to a red one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

const column = readFileSync(join(__dirname, 'ScoringColumn.tsx'), 'utf8');

describe('the search of the penalty list', () => {
  it('is emptied in the one function every card of the list goes through', () => {
    const [, submit] = column.split('async function submitPenalty(');
    const body = submit?.split('// A red or black card of the list waits here')[0] ?? '';
    // After the write on the tablet, and before the catch: a failed write keeps the text.
    const written = body.indexOf('await queueCard({');
    const emptied = body.indexOf("setPenaltyQuery('');");
    const failed = body.indexOf('} catch (err) {');
    expect(written).toBeGreaterThan(-1);
    expect(emptied).toBeGreaterThan(written);
    expect(failed).toBeGreaterThan(emptied);
    expect(column.match(/setPenaltyQuery\(/g)).toHaveLength(2);
  });

  it('is not emptied by a "no" to the red-card question', () => {
    expect(column).toContain('onClose={() => setAskedCard(null)}');
  });

  it('has a name for a screen reader, and is a 44px target', () => {
    expect(column).toMatch(
      /data-testid="penalty-search"[\s\S]{0,260}aria-label=\{t\('scoring\.lice\.penaltySearch'\)\}\s+className="min-h-\[44px\] /,
    );
  });

  it('says "nothing matches" only when the list has entries', () => {
    expect(column).toContain('{entries.length === 0 && (');
    expect(column).toContain('{entries.length > 0 && filteredEntries.length === 0 && (');
    expect(en.scoring.lice.penaltiesNoMatch).toBe('No penalty matches "{query}".');
    expect(fr.scoring.lice.penaltiesNoMatch).toBe('Aucune pénalité ne correspond à « {query} ».');
  });

  it('is written with its accents in French', () => {
    expect(fr.scoring.lice.penaltySearch).toBe('Rechercher une pénalité');
    expect(fr.scoring.lice.penaltiesNone).toBe('Aucune entrée de pénalité configurée.');
  });
});
