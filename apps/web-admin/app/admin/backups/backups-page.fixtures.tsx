import { act } from 'react';
import { expect } from 'vitest';
import type { OpenedPage } from '../../org/[slug]/events/[eventId]/archived-page.fixtures';

/** The backups screen tests share these: the server it reads, and how a test presses. */
export const BACKUPS = '/api/v1/admin/backups';
export const artifact = (kind: 'db' | 'storage', ts: string) => ({
  kind,
  filename: kind === 'db' ? `db-${ts}.sql.gz` : `storage-${ts}.tar.gz`,
  sizeBytes: 1024,
  modifiedAt: '2026-10-30T03:00:00.000Z',
  encrypted: false,
});
export const uploaded = (ts: string, kinds: Array<'db' | 'storage'>) => ({
  id: `upload-${ts}`,
  timestamp: ts,
  displayName: `upload-${ts}`,
  local: { available: false, artifacts: [] },
  cloud: { available: false, artifacts: [] },
  upload: { available: true, artifacts: kinds.map((kind) => artifact(kind, ts)) },
});
export const BOTH = uploaded('20261030T030000Z', ['db', 'storage']);
export const DATABASE = uploaded('20261029T030000Z', ['db']);
export const IMAGES = uploaded('20261028T030000Z', ['storage']);
export const READS = {
  [`${BACKUPS}/status`]: {
    generatedAt: '2026-10-30T12:00:00.000Z',
    cloudConfigured: false,
    lastBackup: null,
    runningOperation: null,
  },
  [`${BACKUPS}/schedule`]: {
    enabled: true,
    frequency: 'daily',
    hourUtc: 3,
    minuteUtc: 0,
    dayOfWeek: 1,
    dayOfMonth: 1,
    retentionCountLocal: 14,
    retentionCountCloud: 60,
    timezoneLabel: 'UTC',
    updatedAt: null,
    nextRunAt: null,
  },
  [BACKUPS]: { generatedAt: '2026-10-30T12:00:00.000Z', backups: [BOTH, DATABASE, IMAGES] },
};

export const UPLOADS = `${BACKUPS}/uploads`;
export const GIB = 1024 * 1024 * 1024;
export const SESSION = {
  uploadId: 'u1',
  filename: 'storage-20261029T030000Z.tar.gz',
  sizeBytes: 1,
  receivedBytes: 0,
  maxChunkBytes: 16 * 1024 * 1024,
  state: 'receiving',
  code: null,
};

/** The file picker, as the browser fills it. */
export async function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

export const text = () => document.body.textContent ?? '';
export const rows = () => [...document.querySelectorAll('tbody tr')];
export const buttonIn = (within: ParentNode, label: string) =>
  [...within.querySelectorAll('button')].filter((b) => b.textContent?.startsWith(label)).at(-1);
/** `press(label, within?)` for the page a test opened. */
export const makePress =
  (opened: () => OpenedPage) =>
  async (label: string, within: ParentNode = document.body) => {
    const target = buttonIn(within, label);
    expect(target, label).toBeDefined();
    await act(async () => target!.click());
    await opened().settle();
  };
