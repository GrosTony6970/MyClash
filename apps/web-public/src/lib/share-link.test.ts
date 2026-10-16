import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_TOURNAMENT_STATUSES,
  publicCanOpenTournament,
  shareLink,
  shareMessageKey,
  type ShareDoors,
} from './share-link';

const URL = 'https://myclash.test/e/open-2027/match/m-1';
const TITLE = 'Dupont vs Martin · Open 2027';

const abort = () => Object.assign(new Error('closed'), { name: 'AbortError' });

function doors(over: Partial<ShareDoors> = {}): Required<ShareDoors> {
  return {
    share: vi.fn().mockResolvedValue(undefined),
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    ...over,
  } as Required<ShareDoors>;
}

describe('shareLink', () => {
  it("opens the phone's share sheet with the address and the tab's title", async () => {
    const phone = doors();

    await expect(shareLink(URL, TITLE, phone)).resolves.toBe('shared');

    expect(phone.share).toHaveBeenCalledWith({ title: TITLE, url: URL });
    expect(phone.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('says nothing and copies nothing when the person closes the sheet', async () => {
    const phone = doors({ share: vi.fn().mockRejectedValue(abort()) });

    await expect(shareLink(URL, TITLE, phone)).resolves.toBe('closed');

    expect(phone.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies the address when the sheet fails for another reason', async () => {
    const phone = doors({ share: vi.fn().mockRejectedValue(new Error('no target')) });

    await expect(shareLink(URL, TITLE, phone)).resolves.toBe('copied');

    expect(phone.clipboard.writeText).toHaveBeenCalledWith(URL);
  });

  it('copies the address on a browser with no share sheet', async () => {
    const desktop = doors({ share: undefined });

    await expect(shareLink(URL, TITLE, desktop)).resolves.toBe('copied');

    expect(desktop.clipboard.writeText).toHaveBeenCalledWith(URL);
  });

  it('says the copy failed when the browser refuses it', async () => {
    const refused = doors({
      share: undefined,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    await expect(shareLink(URL, TITLE, refused)).resolves.toBe('failed');
  });

  it('says the copy failed on a browser with no clipboard', async () => {
    await expect(shareLink(URL, TITLE, {})).resolves.toBe('failed');
  });

  it('calls each door as a method of the browser object it was given', async () => {
    // `navigator.share` taken off `navigator` throws "Illegal invocation".
    const nav = {
      share(this: unknown) {
        return this === nav ? Promise.resolve() : Promise.reject(new TypeError('Illegal'));
      },
    };

    await expect(shareLink(URL, TITLE, nav)).resolves.toBe('shared');
  });
});

describe('publicCanOpenTournament', () => {
  const open = { status: 'running', eventKind: 'standard' } as const;

  it('is true for a Tournament the public reads', () => {
    expect(publicCanOpenTournament(open, 'published')).toBe(true);
    expect(publicCanOpenTournament({ status: 'published', eventKind: 'club' }, 'running')).toBe(
      true,
    );
  });

  it('is true for each status the API shows to the public, and for no other', () => {
    for (const status of ['published', 'running', 'completed']) {
      expect(publicCanOpenTournament(open, status), status).toBe(true);
    }
    // An organiser can archive a Tournament: its club still opens it, the public does not.
    for (const status of ['draft', 'archived', '', 'a status of next year']) {
      expect(publicCanOpenTournament(open, status), status).toBe(false);
    }
  });

  it("names the statuses the API's own list names", () => {
    const api = readFileSync(
      join(__dirname, '../../../api/src/common/auth/competition-visibility.ts'),
      'utf8',
    );
    expect(api).toContain(
      "PUBLIC_TOURNAMENT_STATUSES = new Set(['published', 'running', 'completed']);",
    );
    expect([...PUBLIC_TOURNAMENT_STATUSES]).toEqual(['published', 'running', 'completed']);
  });

  it('is false for a Tournament of a draft Event, and of a test Event', () => {
    expect(publicCanOpenTournament({ status: 'draft', eventKind: 'standard' }, 'published')).toBe(
      false,
    );
    expect(publicCanOpenTournament({ status: 'running', eventKind: 'test' }, 'running')).toBe(
      false,
    );
  });

  it('is false when the Event could not be read', () => {
    expect(publicCanOpenTournament(null, 'published')).toBe(false);
  });
});

describe('shareMessageKey', () => {
  it('has words for a copy and for a failed copy only', () => {
    expect(shareMessageKey('copied')).toBe('publicApp.share.copied');
    expect(shareMessageKey('failed')).toBe('publicApp.share.copyFailed');
    expect(shareMessageKey('shared')).toBeNull();
    expect(shareMessageKey('closed')).toBeNull();
    expect(shareMessageKey(null)).toBeNull();
  });
});

// Ruling 2026-10-16: the button is the shared Button's neutral outline, not one drawn by hand.
describe('the Share button', () => {
  it("is the shared Button's outline, kept 44px tall", () => {
    const source = readFileSync(join(__dirname, '../components/ShareButton.tsx'), 'utf8');
    expect(source).toContain("import { Button } from '@myclash/ui';");
    expect(source).toMatch(/<Button\s+type="button"\s+variant="outline"/);
    expect(source).toContain('className="min-h-11 shrink-0"');
    expect(source).not.toContain('<button');
  });
});
