import { describe, expect, it } from 'vitest';
import { UpdateEventDto } from '../events/dto/events.dto';

const updateEventSchema = UpdateEventDto.schema;
import { photoToken, photoTokenMatches } from './photo-token';

const SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';

describe('photoToken', () => {
  it('is the same for the same Event and version, in 43 url-safe characters', () => {
    const token = photoToken(SECRET, EVENT, 1);
    expect(token).toBe(photoToken(SECRET, EVENT, 1));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('changes with the version, the Event and the secret', () => {
    const token = photoToken(SECRET, EVENT, 1);
    expect(photoToken(SECRET, EVENT, 2)).not.toBe(token);
    expect(photoToken(SECRET, '00000000-0000-4000-8000-000000000000', 1)).not.toBe(token);
    expect(photoToken(`${SECRET}-other`, EVENT, 1)).not.toBe(token);
  });
});

describe('photoTokenMatches', () => {
  it('accepts the token of the current version', () => {
    expect(photoTokenMatches(SECRET, EVENT, 3, photoToken(SECRET, EVENT, 3))).toBe(true);
  });

  it('refuses the token of a retired version, so a rotated QR code stops working', () => {
    expect(photoTokenMatches(SECRET, EVENT, 4, photoToken(SECRET, EVENT, 3))).toBe(false);
  });

  it.each([undefined, null, '', 'x'.repeat(42), 42, ['a']])('refuses %j', (candidate) => {
    expect(photoTokenMatches(SECRET, EVENT, 1, candidate)).toBe(false);
  });
});

describe('the Event update carries the photo mode', () => {
  it('accepts off, live and approve', () => {
    for (const photoMode of ['off', 'live', 'approve']) {
      expect(updateEventSchema.parse({ photoMode })).toEqual({ photoMode });
    }
  });

  it('refuses any other mode', () => {
    expect(() => updateEventSchema.parse({ photoMode: 'public' })).toThrow();
  });
});
