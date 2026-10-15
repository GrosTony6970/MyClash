import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';

/**
 * The column hint of the Global Profiles import was a string of English header names in the
 * page: a French super admin was never told the import also reads "prenom", "nom", "courriel".
 */
describe('the Global Profiles import column hint', () => {
  it("names its columns in the reader's words, the French headers it reads included", () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain("'given_name, family_name");
    expect(source).toContain("t('admin.globalPersonsImport.csvColumns')");
    const fr = createTranslator(getMessages('fr'));
    expect(fr('admin.globalPersonsImport.csvColumns')).toMatch(/^prenom, nom, nom_affiche, /);
  });
});
