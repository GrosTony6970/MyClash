import { describe, expect, it } from 'vitest';
import { deleteWordTyped } from './delete-word';

describe('deleteWordTyped', () => {
  it('takes the word in small letters, capitals or both', () => {
    for (const typed of ['DELETE', 'delete', 'Delete', 'dElEtE']) {
      expect(deleteWordTyped(typed, 'DELETE'), typed).toBe(true);
    }
  });

  it('takes stray spaces around the word', () => {
    expect(deleteWordTyped('  supprimer ', 'SUPPRIMER')).toBe(true);
  });

  it("takes the reader's word only", () => {
    expect(deleteWordTyped('delete', 'SUPPRIMER')).toBe(false);
    expect(deleteWordTyped('supprimer', 'DELETE')).toBe(false);
  });

  it('refuses a part of the word, a longer word and nothing', () => {
    expect(deleteWordTyped('DELET', 'DELETE')).toBe(false);
    expect(deleteWordTyped('DELETED', 'DELETE')).toBe(false);
    expect(deleteWordTyped('', 'DELETE')).toBe(false);
    expect(deleteWordTyped('   ', 'DELETE')).toBe(false);
  });

  it('never matches an empty word', () => {
    expect(deleteWordTyped('', '')).toBe(false);
  });
});
