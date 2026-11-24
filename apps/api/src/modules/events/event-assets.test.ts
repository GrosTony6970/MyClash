/**
 * `storeEventImage`, the one writer of the Event's, a Tournament's and a team's images: its two
 * refusals and its path. The file's name is the caller's to send; the path must stay inside the
 * folder the route chose, whatever that name holds.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { storeEventImage } from './event-assets';

function storageDouble() {
  const upload = vi.fn(async () => ({ error: null }));
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }));
  const storage = {
    getBucket: vi.fn(async () => ({ data: { id: 'event-assets' }, error: null })),
    createBucket: vi.fn(),
    from: vi.fn(() => ({ upload, getPublicUrl })),
  };
  return { upload, storage: storage as never, getBucket: storage.getBucket };
}

const png = (filename: string) => ({ buffer: Buffer.from([1]), filename, mimetype: 'image/png' });
const pathOf = (upload: ReturnType<typeof storageDouble>['upload']) =>
  (upload.mock.calls[0] as unknown as [string])[0];

describe('storeEventImage', () => {
  it('keeps a name with ../ inside the folder', async () => {
    const files = storageDouble();
    const url = await storeEventImage(files.storage, 'teams/t1', png('../../events/../x/Logo.PNG'));
    const path = pathOf(files.upload);
    expect(path).toMatch(/^teams\/t1\/logo-\d+-events-x-logo\.png$/);
    expect(path).not.toContain('..');
    expect(url).toBe(`https://cdn/${path}`);
  });

  it('names a file with no usable name "image", and writes the extension of its type', async () => {
    const files = storageDouble();
    await storeEventImage(files.storage, 'events/e1', {
      buffer: Buffer.from([1]),
      filename: '///.webp',
      mimetype: 'image/webp',
    });
    expect(pathOf(files.upload)).toMatch(/^events\/e1\/logo-\d+-image\.webp$/);
  });

  it('refuses a type that is not PNG, JPEG or WebP, and stores nothing', async () => {
    const files = storageDouble();
    const svg = { ...png('logo.svg'), mimetype: 'image/svg+xml' };
    await expect(storeEventImage(files.storage, 'teams/t1', svg)).rejects.toThrow(
      new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.'),
    );
    expect(files.upload).not.toHaveBeenCalled();
    expect(files.getBucket).not.toHaveBeenCalled();
  });

  it('refuses an empty file, and stores nothing', async () => {
    const files = storageDouble();
    const empty = { buffer: Buffer.alloc(0), filename: '', mimetype: '' };
    await expect(storeEventImage(files.storage, 'teams/t1', empty)).rejects.toThrow(
      new BadRequestException('No logo file uploaded.'),
    );
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('says "hero" for a hero, in its path and its refusals', async () => {
    const files = storageDouble();
    await storeEventImage(files.storage, 'events/e1', png('Banner.png'), 'hero');
    expect(pathOf(files.upload)).toMatch(/^events\/e1\/hero-\d+-banner\.png$/);
    const empty = { buffer: Buffer.alloc(0), filename: '', mimetype: '' };
    await expect(storeEventImage(files.storage, 'events/e1', empty, 'hero')).rejects.toThrow(
      'No hero file uploaded.',
    );
    await expect(
      storeEventImage(
        files.storage,
        'events/e1',
        { ...png('b.gif'), mimetype: 'image/gif' },
        'hero',
      ),
    ).rejects.toThrow('Hero upload must be a PNG, JPEG, or WebP image.');
  });
});
