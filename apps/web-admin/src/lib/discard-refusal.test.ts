import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { applyFailureMessage, discardFailureMessage, foughtBoutsAtStake } from './discard-refusal';

const t = (key: string) => key;

const refused = (
  status: number,
  code: string | null,
  details: Record<string, unknown> | null = null,
): ApiFailure => ({
  kind: 'http',
  status,
  detail: 'An English sentence from the API.',
  code,
  details,
  validationErrors: null,
});

describe('discardFailureMessage', () => {
  it('says "only the owner" in the reader’s language', () => {
    expect(discardFailureMessage(refused(403, 'discard_requires_owner'), t, 'fallback')).toBe(
      'admin.common.discardRequiresOwner',
    );
  });

  it('leaves every other refusal to the usual message', () => {
    expect(discardFailureMessage(refused(403, 'FORBIDDEN'), t, 'fallback')).toBe(
      'An English sentence from the API.',
    );
    expect(discardFailureMessage({ kind: 'aborted' }, t, 'fallback')).toBeNull();
  });

  it('is these words (ruling 279)', () => {
    expect(en.admin.common.discardRequiresOwner).toBe(
      'Only the owner of the organisation can delete bouts that have been fought.',
    );
    expect(fr.admin.common.discardRequiresOwner).toBe(
      "Seul un propriétaire de l'organisation peut supprimer des assauts déjà disputés.",
    );
  });
});

describe('applyFailureMessage (ruling 284)', () => {
  it('sends the reader to the page that shows the count, whatever the count', () => {
    const failure = refused(409, 'scored_bouts_would_be_discarded', { scoredMatches: 3 });
    expect(applyFailureMessage(failure, t, 'fallback')).toBe(
      'organizer.aiAssistant.applyFoughtBouts',
    );
    expect(applyFailureMessage(refused(409, 'scored_bouts_would_be_discarded'), t, 'x')).toBe(
      'organizer.aiAssistant.applyFoughtBouts',
    );
  });

  it('leaves every other refusal to the usual message', () => {
    expect(applyFailureMessage(refused(409, 'CONFLICT'), t, 'fallback')).toBe(
      'An English sentence from the API.',
    );
    expect(applyFailureMessage({ kind: 'aborted' }, t, 'fallback')).toBeNull();
  });

  it('is these words, and the assistant page says them', () => {
    expect(en.organizer.aiAssistant.applyFoughtBouts).toBe(
      'This draft would delete bouts that have already been fought. The assistant never does that. Regenerate on the Pools page or on the bracket page, where the count is shown.',
    );
    expect(fr.organizer.aiAssistant.applyFoughtBouts).toBe(
      'Ce brouillon supprimerait des assauts déjà disputés. L’assistant ne le fait jamais. Régénérez depuis la page des poules ou celle du tableau, où leur nombre est affiché.',
    );
    const page = readFileSync(
      join(__dirname, '..', '..', 'app/org/[slug]/events/[eventId]/ai-assistant/page.tsx'),
      'utf8',
    );
    expect(page).toContain("applyFailureMessage(r, t, t('organizer.aiAssistant.applyError'))");
  });
});

describe('foughtBoutsAtStake', () => {
  it('reads the count of the refusal that asks for the discard', () => {
    const failure = refused(409, 'scored_bouts_would_be_discarded', { scoredMatches: 3 });
    expect(foughtBoutsAtStake(failure)).toBe(3);
  });

  it('is null for "Pools already exist" and for every other answer', () => {
    expect(foughtBoutsAtStake(refused(409, 'CONFLICT', { scoredMatches: 3 }))).toBeNull();
    expect(foughtBoutsAtStake(refused(409, 'scored_bouts_would_be_discarded'))).toBeNull();
    expect(foughtBoutsAtStake({ kind: 'network' })).toBeNull();
  });
});

/**
 * The pages are too large to mount for each door, so each door that deletes a
 * phase is pinned as text: its failed call goes through `discardFailureMessage`.
 */
describe('the doors that delete fought bouts say "only the owner" in the reader’s language', () => {
  const EVENT_ROOT = join(__dirname, '..', '..', 'app', 'org', '[slug]', 'events', '[eventId]');
  const BRACKET_PAGE = readFileSync(join(EVENT_ROOT, 'bracket', 'page.tsx'), 'utf8');
  const POOLS_PAGE = readFileSync(join(EVENT_ROOT, 'pools', 'page.tsx'), 'utf8');

  it.each<[string, string, string]>([
    ['Regenerate bracket', BRACKET_PAGE, "t('admin.common.generationFailed')"],
    ['Delete bracket', BRACKET_PAGE, "t('admin.common.deleteFailed')"],
    ['generate Pools again', POOLS_PAGE, "t('admin.common.poolGenerationFailed')"],
  ])('%s', (_door, page, fallback) => {
    expect(page).toContain(`discardFailureMessage(r, t, ${fallback})`);
  });
});
