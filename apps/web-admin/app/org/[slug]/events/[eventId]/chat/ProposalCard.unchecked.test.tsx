import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ProposalCard, type ChatProposal } from './ProposalCard';

/**
 * The chat's proposal card applies a draft on Confirm, so it assigns referees (CLAUDE.md rule 8;
 * ADR-016, 2026-11-13; design decision 11). A team's slots have no names in slice 1b-1: the server
 * marks a referee draft of a team Pool or bout with `uncheckedFighters`, and the card says so. The
 * note blocks nothing: Confirm stays.
 */
const NOTICE = 'MyClash cannot check these Fighters: this team has Fighters with no name';

const refereeProposal = (uncheckedFighters?: true): ChatProposal => ({
  id: 'd-1',
  draftType: 'referee_assignments',
  status: 'ready',
  summary: 'Anna referees Pool A',
  proposedActions: [{ kind: 'assign_referee', userId: 'p-1', role: 'referee', poolId: 'pool-1' }],
  validationState: { ok: true },
  ...(uncheckedFighters ? { uncheckedFighters } : {}),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(proposal: ChatProposal) {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ProposalCard
          proposal={proposal}
          busy={false}
          onConfirm={() => undefined}
          onReject={() => undefined}
          t={(key) => key}
        />
      </I18nProvider>,
    );
  });
}

const note = () => container.querySelector('[role="note"]');

describe('the chat proposal card of a referee draft', () => {
  it('says MyClash cannot check the Fighters of a team Pool, and still offers Confirm', async () => {
    await render(refereeProposal(true));
    expect(note()?.textContent).toBe(NOTICE);
    expect(container.textContent).toContain('organizer.chat.proposal.confirm');
  });

  it('says nothing of the kind on a Pool of Fighters', async () => {
    await render(refereeProposal());
    expect(note()).toBeNull();
  });
});
