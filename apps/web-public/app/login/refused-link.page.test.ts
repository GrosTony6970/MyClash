import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

/**
 * A mailed link that signed nobody in, on the participant sign-in page (operator rulings 360,
 * 362).
 *
 * Léa clicks a sign-in link that is two hours old. The API's door sends her here with the
 * reason in the address, and the page opens on its sentence. The reason is read on the
 * server too, from the page's own `searchParams`: the first paint already says it.
 */
// web-public's vitest compiles no TSX: the screen is read as text.
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('the participant sign-in page after a mailed link that signed nobody in', () => {
  it('reads the reason from its address, through the one owner of its sentence', () => {
    expect(page).toContain('refusedLinkKey(use(query)[SIGNUP_REFUSED_PARAM])');
    expect(page).toContain(
      'export default function PublicLoginPage({ searchParams }: { searchParams: Query }) {',
    );
  });

  it('opens on that sentence, as an error', () => {
    expect(page).toContain('useState<string | null>(useRefusedLinkWords(searchParams, t))');
    expect(page).toContain('{error && <AuthNotice tone="error">{error}</AuthNotice>}');
  });

  it('is these words, in both languages', () => {
    expect(en.auth.login.errors.linkExpired).toBe(
      'This link has expired or was already used. Ask for a new one.',
    );
    expect(fr.auth.login.errors.linkExpired).toBe(
      'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.',
    );
    expect(en.auth.login.errors.linkUnchecked).toBe(
      'We could not check this link. Open it again in a moment.',
    );
    expect(fr.auth.login.errors.linkUnchecked).toBe(
      "Nous n'avons pas pu vérifier ce lien. Rouvrez-le dans un instant.",
    );
  });
});
