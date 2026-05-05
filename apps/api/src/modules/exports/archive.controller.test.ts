import { describe, expect, it } from 'vitest';
import { ExportsController } from './exports.controller';

describe('ExportsController archive routes', () => {
  it('exposes guarded organizer archive and restore handlers', () => {
    const controller = new ExportsController({} as never, {} as never, {} as never);

    expect(typeof controller.eventArchive).toBe('function');
    expect(typeof controller.tournamentArchive).toBe('function');
    expect(typeof controller.restorePreview).toBe('function');
    expect(typeof controller.restoreArchive).toBe('function');
  });
});
