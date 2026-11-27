import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/admin';
import { I18nProvider } from '@/i18n/I18nProvider';
import { POOLS, POOLS_EN, UUID, draftOf } from '../ai-assistant/draft.fixtures';
import { ProposalCard, type ChatProposal } from './ProposalCard';

/**
 * The chat's proposal card shows a draft in the words the assistant page uses (ruling 995):
 * one view, `DraftActionsView`. It used to list the raw action, `tournamentId: <uuid>`.
 */
const t = createTranslator(messages.en);

/** The card's text, as an organiser reads it. */
function cardText(proposal: ChatProposal): string {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">
      <ProposalCard proposal={proposal} busy={false} onConfirm={noop} onReject={noop} t={t} />
    </I18nProvider>,
  );
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
const noop = () => undefined;

describe('the chat proposal card', () => {
  it('shows the draft in the page’s words, its kind by name, and no id', () => {
    const text = cardText(draftOf([POOLS]));

    expect(text).toContain(POOLS_EN);
    expect(text).toContain('Pool plan');
    expect(text).not.toContain('pool_plan');
    expect(text).not.toMatch(UUID);
  });

  it('says Apply of the proposal stopped before it finished, not that it failed its check', () => {
    const text = cardText(draftOf([POOLS], { status: 'failed', applyStarted: true }));

    expect(text).toContain('Apply stopped before it finished. Part of it may have run');
    expect(text).not.toContain('validation errors');
  });

  it('names a roster referee with no name on record in words, never a blank', () => {
    const text = cardText(
      draftOf([
        {
          kind: 'assign_referee',
          referee: { name: '' },
          role: { name: 'Lead referee' },
          pool: { number: 2, tournament: 'Longsword Open' },
        },
      ]),
    );

    expect(text).toContain('Assign Unknown referee as Lead referee to Pool 2 of Longsword Open');
  });
});
