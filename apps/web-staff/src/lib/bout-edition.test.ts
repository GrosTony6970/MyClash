import { afterEach, describe, expect, it, vi } from 'vitest';
import { editionOf } from './bout-edition';

describe('editionOf', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  it('decides a bout by the edition the server sent with it, in silence', () => {
    expect(editionOf({ id: 'old', decisionEdition: '2026-04' })).toBe('2026-04');
    expect(editionOf({ id: 'new', decisionEdition: '2026-10' })).toBe('2026-10');
    expect(warn).not.toHaveBeenCalled();
  });

  it('decides a kept bout that carries no edition by today’s, and says so', () => {
    expect(editionOf({ id: 'kept' })).toBe('2026-10');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Bout kept');
  });

  it('decides a bout whose edition this bundle does not know by today’s, never throwing', () => {
    expect(editionOf({ id: 'newer', decisionEdition: '2027-03' })).toBe('2026-10');
    expect(warn.mock.calls[0]?.[0]).toContain('(2027-03)');
  });

  it('says it once per bout, not on every render', () => {
    editionOf({ id: 'often' });
    editionOf({ id: 'often' });
    editionOf({ id: 'often', decisionEdition: 'x' });
    editionOf({ id: 'other' });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
