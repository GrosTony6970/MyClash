import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';
import { requestStatusKey, requestTypeKey } from './request-copy';

/**
 * The Exchange corrections page said "Void exchange", "Restore exchange",
 * "Loading..." and "3 requests" to a French super admin, printed the raw status
 * word, and named a bout with no way to open it.
 */
const en = createTranslator(getMessages('en'));
const fr = createTranslator(getMessages('fr'));
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('what a row of the Exchange corrections page says', () => {
  it.each<['void_exchange' | 'revert_void_exchange', string, string]>([
    ['void_exchange', 'Void an exchange', 'Invalider un échange'],
    ['revert_void_exchange', 'Restore an exchange', 'Restaurer un échange'],
  ])('%s is named in both languages, as in the review queue', (type, english, french) => {
    expect(en(requestTypeKey(type))).toBe(english);
    expect(fr(requestTypeKey(type))).toBe(french);
  });

  it.each<['pending' | 'approved' | 'rejected', string, string]>([
    ['pending', 'Pending', 'En attente'],
    ['approved', 'Approved', 'Approuvée'],
    ['rejected', 'Rejected', 'Rejetée'],
  ])('the status %s is a word of the reader’s language', (status, english, french) => {
    expect(en(requestStatusKey(status))).toBe(english);
    expect(fr(requestStatusKey(status))).toBe(french);
  });

  it('the count has no plural to get wrong', () => {
    expect(en('admin.adminDesignReq.requestCount', { count: 1 })).toBe('Requests: 1');
    expect(fr('admin.adminDesignReq.requestCount', { count: 3 })).toBe('Demandes : 3');
    expect(fr('admin.adminDesignReq.loading')).toBe('Chargement…');
  });
});

describe('the page uses them', () => {
  it('no English literal is left for the type, the status, the count or the wait', () => {
    expect(page).not.toMatch(/Void exchange|Restore exchange|Loading\.\.\.|requests`/);
    expect(page).toMatch(/t\(requestTypeKey\(request\.request_type\)\)/);
    expect(page).toMatch(/t\(requestTypeKey\(rejectTarget\.request_type\)\)/);
    expect(page).toMatch(/t\(requestStatusKey\(request\.status\)\)/);
    expect(page).toMatch(/t\('admin\.adminDesignReq\.requestCount', \{ count: items\.length \}\)/);
    expect(page).toMatch(/t\('admin\.adminDesignReq\.loading'\)/);
  });

  it('the bout’s line opens the bout’s page, and only that line', () => {
    expect(page).toMatch(
      /<IdentifiedRow\s+label=\{request\.matchLabel\}\s+id=\{request\.match_id\}\s+href=\{request\.boutHref\}\s+\/>/,
    );
    expect(page.match(/href=\{request\.boutHref\}/g)).toHaveLength(1);
    // A line with a label and an address is a link to that address.
    expect(page).toMatch(/if \(label && href\) \{\s+return \(\s+<Link\s+href=\{href\}/);
    expect(page).toMatch(/boutHref: string \| null;/);
  });
});
