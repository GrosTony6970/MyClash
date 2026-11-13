/**
 * The committed-refusal cases of `scripts/db-fightbook-race-probe.mjs` (migration 0270, Review
 * Focus 5): a refused scan leaves its code scannable. Committed, because the FightBook probe reads
 * a refusal in a savepoint it rolls back, which would restore a burnt code too.
 *
 * Each case, as the API makes it: a scan in its own transaction, rolled back by the refusal. Then
 * the cause is lifted (committed) and the SAME scanner scans the SAME code: it goes through, so
 * the refusal left the code. Julie scans Paul's codes; she has a request to him waiting.
 *
 * `kit` is the race probe's: `check`, `watch` (a connection outside the scans), `scanCommitted`
 * (hash, scanner, atEvent: one scan in its own transaction, settled), `showCode`, `codeLeft`, the
 * profiles `F` and the fixture's `EVENT`.
 */
async function refusedThenSameCode(kit, word, { before = async () => {}, atEvent = false, fix }) {
  const { F } = kit;
  const hash = await kit.showCode(F.paul);
  await before();
  const refused = await kit.scanCommitted(hash, F.julie, atEvent);
  await fix();
  const again = await kit.scanCommitted(hash, F.julie, atEvent);
  kit.check(
    `a committed ${word}, then the same code`,
    [refused, again.value?.notify, await kit.codeLeft(hash)],
    [{ refused: word }, true, 0],
  );
}

/** Three checks: `already_asked`, `bad_event` and `not_on_fightbook` each leave the code. */
export async function refusedScansLeaveTheCode(kit) {
  const { F, EVENT, watch } = kit;
  const withdrawn = () =>
    watch`UPDATE spar_requests SET status = 'withdrawn' WHERE asker_global_person_id = ${F.julie}
      AND receiver_global_person_id = ${F.paul} AND status = 'pending'`;
  const fightBook = (on) =>
    watch`UPDATE global_persons SET fightbook_enabled = ${on} WHERE id = ${F.paul}`;
  await refusedThenSameCode(kit, 'already_asked', { fix: withdrawn });
  await refusedThenSameCode(kit, 'bad_event', {
    before: withdrawn,
    atEvent: true,
    fix: () => watch`INSERT INTO persons (event_id, given_name, family_name, global_person_id)
      VALUES (${EVENT}, 'Paul', 'Race', ${F.paul})`,
  });
  await refusedThenSameCode(kit, 'not_on_fightbook', {
    before: async () => {
      await withdrawn();
      await fightBook(false);
    },
    fix: () => fightBook(true),
  });
}
