import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';

/**
 * The column hint of the roster import names, in each language, exactly the headers of that
 * language's template (O18, ruled 2026-10-15): an organiser who copies the hint and one who
 * downloads the template write the same file. The API's own test proves each template
 * imports whole (`csv-import.service.test.ts`).
 */
const SAMPLES = path.resolve(__dirname, '../../../../../../../public/csv-samples');

describe('the column hint and the template', () => {
  it.each(['en', 'fr'] as const)('name the same headers in %s', (locale) => {
    const t = createTranslator(getMessages(locale));
    const file = readFileSync(path.join(SAMPLES, `participants-${locale}.csv`), 'utf8');
    // The file opens with a byte-order mark (the last test): the header follows it.
    const header = file.slice(1).split('\n')[0]!;
    const headers = header.split(locale === 'fr' ? ';' : ',');
    expect(t('organizer.personsImport.csvColumns').split(', ')).toEqual(headers);
  });

  it('starts each template with the mark a spreadsheet reads accents by', () => {
    for (const locale of ['en', 'fr']) {
      const bytes = readFileSync(path.join(SAMPLES, `participants-${locale}.csv`));
      expect([...bytes.subarray(0, 3)], locale).toEqual([0xef, 0xbb, 0xbf]);
    }
  });
});
