import { describe, expect, it } from 'vitest';
import { voidConfirmCopy } from './void-confirm-copy';

/**
 * The defect this pins is a LIE, not a crash: one confirm string told every
 * organiser that voiding reopened "the other bouts this record closed", and a
 * cascaded child closed none of them. Acting on it — expecting the fighter back
 * in the tournament — is how a withdrawn fighter ends up unlisted at a piste.
 */
describe('voidConfirmCopy', () => {
  it('tells a CHILD that only this bout reopens and the fighter stays withdrawn', () => {
    const copy = voidConfirmCopy({ role: 'child', childCount: 0, parentActive: true });

    expect(copy.body.map((line) => line.key)).toEqual([
      'organizer.bracketPage.voidRecordBodyRestores',
      'organizer.bracketPage.voidRecordBodyChildStaysWithdrawn',
    ]);
    // The sentence a child must never carry: it closed nothing.
    expect(copy.body.map((line) => line.key)).not.toContain(
      'organizer.bracketPage.voidRecordBodyReopensMany',
    );
  });

  it('tells a child whose parent is already voided that nothing else changes', () => {
    const copy = voidConfirmCopy({ role: 'child', childCount: 0, parentActive: false });

    expect(copy.body.map((line) => line.key)).toEqual([
      'organizer.bracketPage.voidRecordBodyRestores',
      'organizer.bracketPage.voidRecordBodyChildParentGone',
    ]);
  });

  it('gives a ROOT the real number of bouts its void reopens', () => {
    const copy = voidConfirmCopy({ role: 'root', childCount: 4, parentActive: false });

    expect(copy.body).toEqual([
      { key: 'organizer.bracketPage.voidRecordBodyRestores' },
      { key: 'organizer.bracketPage.voidRecordBodyReopensMany', values: { count: 4 } },
      { key: 'organizer.bracketPage.voidRecordBodyUnadvances' },
    ]);
  });

  it('uses the singular sentence for a single reopened bout', () => {
    // `t()` has no plural engine, so a count of one needs its own key rather
    // than "the 1 other bouts".
    const copy = voidConfirmCopy({ role: 'root', childCount: 1, parentActive: false });

    expect(copy.body[1]).toEqual({ key: 'organizer.bracketPage.voidRecordBodyReopensOne' });
  });

  it('says only what is true of every record for a standalone one', () => {
    const copy = voidConfirmCopy({ role: 'standalone', childCount: 0, parentActive: false });

    expect(copy.body.map((line) => line.key)).toEqual([
      'organizer.bracketPage.voidRecordBodyRestores',
      'organizer.bracketPage.voidRecordBodyUnadvances',
    ]);
    expect(copy.hint).toBeNull();
  });

  it('degrades to the standalone copy when the response carries no cascade', () => {
    // A record read from a deploy without the cascade block. Guessing `root`
    // would reinstate exactly the claim this helper exists to remove.
    expect(voidConfirmCopy(undefined).body.map((line) => line.key)).toEqual([
      'organizer.bracketPage.voidRecordBodyRestores',
      'organizer.bracketPage.voidRecordBodyUnadvances',
    ]);
    expect(voidConfirmCopy(null).hint).toBeNull();
  });

  it('never claims reopened bouts for a root the API reports with none', () => {
    // Not a shape the API produces — role is derived from the count. The guard
    // is here so a change on that side cannot make the copy read "the 0 other
    // pool bouts".
    const copy = voidConfirmCopy({ role: 'root', childCount: 0, parentActive: false });

    expect(copy.body.map((line) => line.key)).not.toContain(
      'organizer.bracketPage.voidRecordBodyReopensMany',
    );
    expect(copy.hint).toBeNull();
  });

  it('surfaces the consequence sentence as the persistent panel hint', () => {
    // The truth must be readable without opening the dialog: the panel is what
    // an organiser looks at before deciding to click Void at all.
    expect(voidConfirmCopy({ role: 'root', childCount: 2, parentActive: false }).hint).toEqual({
      key: 'organizer.bracketPage.voidRecordBodyReopensMany',
      values: { count: 2 },
    });
    expect(voidConfirmCopy({ role: 'child', childCount: 0, parentActive: true }).hint).toEqual({
      key: 'organizer.bracketPage.voidRecordBodyChildStaysWithdrawn',
    });
  });
});
