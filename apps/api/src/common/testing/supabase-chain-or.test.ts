/**
 * A quoted value in an `.or()` string.
 *
 * PostgREST reads `,` `.` `:` `(` `)` as syntax, so a value that may hold one
 * goes in double quotes, with `"` and `\` escaped by a backslash. The double reads
 * such a value as PostgREST does. No server filter quotes one today: the restamp
 * that did (a ruleset code is free text) moved into the database (0229).
 */
import { describe, expect, it } from 'vitest';
import { supabaseFrom } from './supabase-chain';
import { parseOr } from './supabase-chain-or';

const RULESETS = {
  matches: {
    rows: [
      { id: 'plain', code: 'TF_v1', version: '1.0.0' },
      { id: 'comma', code: 'a,b', version: '1.0.0' },
      { id: 'paren', code: 'cap(5)', version: '2.0.0' },
      { id: 'quote', code: 'say "x"', version: '2.0.0' },
      { id: 'slash', code: 'back\\slash', version: '2.0.0' },
      { id: 'none', code: null, version: '2.0.0' },
    ],
  },
} as const;

const ids = (data: unknown) => (data as Array<{ id: string }>).map((row) => row.id);
const matching = async (source: string) =>
  ids((await supabaseFrom(RULESETS)('matches').select().or(source)).data);

describe('a quoted value in an or filter', () => {
  it('reads a comma inside quotes as the value, not as a sibling separator', async () => {
    expect(await matching('code.eq."a,b"')).toEqual(['comma']);
    // Two siblings, the first one quoted: the second is still read.
    expect(await matching('code.eq."a,b",code.eq.TF_v1')).toEqual(['plain', 'comma']);
  });

  it('reads a parenthesis inside quotes as the value, not as a nested group', async () => {
    expect(await matching('code.eq."cap(5)"')).toEqual(['paren']);
    expect(await matching('code.eq."cap(5)",code.eq."a,b"')).toEqual(['comma', 'paren']);
  });

  it('takes the quotes off, and the backslash off an escaped character', async () => {
    expect(await matching('code.eq."say \\"x\\""')).toEqual(['quote']);
    expect(await matching('code.eq."back\\\\slash"')).toEqual(['slash']);
    expect(parseOr('code.eq."say \\"x\\""')[0]?.value).toBe('say "x"');
    // An escaped quote does not close the value: the comma after it is text.
    expect(parseOr('code.eq."a\\",b",version.eq.1').map((term) => term.value)).toEqual([
      'a",b',
      '1',
    ]);
  });

  it('compares a quoted value under neq as an unquoted one, a null cell left out', async () => {
    expect(await matching('version.neq."1.0.0"')).toEqual(['paren', 'quote', 'slash', 'none']);
    // `code <> 'TF_v1'` over NULL is not TRUE: 'none' is not matched.
    expect(await matching('code.neq."TF_v1"')).toEqual(['comma', 'paren', 'quote', 'slash']);
  });

  it('reads a quote in the middle of a value as text: only the first character opens one', async () => {
    // A name search for `a"b` builds this. A quote that opened anywhere would
    // swallow the second sibling into the first one's value.
    expect(parseOr('code.ilike.%a"b%,version.ilike.%a"b%').map((term) => term.column)).toEqual([
      'code',
      'version',
    ]);
    expect(await matching('code.ilike.%y "x%,version.eq.1.0.0')).toEqual([
      'plain',
      'comma',
      'quote',
    ]);
  });

  it('still refuses the quoted shapes no caller builds', () => {
    const chain = () => supabaseFrom(RULESETS)('matches').select();
    expect(() => chain().or('code.in.("a","b")')).toThrow(/a quoted value/);
    expect(() => chain().or('code.ilike."a%"')).toThrow(/a quoted value/);
    expect(() => chain().or('code.eq."open')).toThrow(/a quoted value that does not close/);
    expect(() => chain().or('code.eq."a"b')).toThrow(/a quoted value that does not close/);
  });
});
