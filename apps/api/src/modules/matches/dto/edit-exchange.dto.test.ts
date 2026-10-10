import { describe, expect, it } from 'vitest';
import { EditExchangeDto } from './matches.dto';

/**
 * The body the pad sends for "Edit as no exchange"
 * (`apps/web-staff/src/lib/no-exchange-rewrite.ts`). The pad sent the fields
 * of a NEW hit beside it, and this route takes none of them: every rewrite
 * was refused. The pad's body is typed by this schema's generated type.
 */
const REWRITE = { type: 'no_exchange', noExchangeReason: 'other', reason: 'wrong fighter' };
const takes = (body: unknown) => EditExchangeDto.schema.safeParse(body).success;

describe('the body of an exchange edit', () => {
  it('takes the pad’s rewrite as no exchange', () => {
    expect(takes(REWRITE)).toBe(true);
  });

  it.each([
    ['an id', { clientUuid: 'a0000000-0000-4000-8000-0000000000aa' }],
    ['a sequence', { sequence: 0 }],
    ['a time', { occurredAt: '2026-10-10T10:00:00.000Z' }],
  ])('refuses %s: an edit is not a new hit', (_, extra) => {
    expect(takes({ ...REWRITE, ...extra })).toBe(false);
  });
});
