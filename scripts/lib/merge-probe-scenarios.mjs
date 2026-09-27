/**
 * What a merge moves and keeps, and what its revert moves back (rulings 116, 157, 159, 161):
 * the scenarios of `scripts/db-merge-probe.mjs`. The refusals live in that script.
 */
import {
  I,
  MANY,
  P,
  PERSON,
  U,
  W,
  check,
  followedBy,
  id,
  lastMerge,
  merge,
  onProfile,
  profile,
  refusal,
  revert,
  scenario,
  snapshot,
} from './merge-probe-fixture.mjs';

async function checkMoves(q) {
  check('merge answer', await merge(q, P.source, P.target), {
    persons: 2,
    workshopInstructors: 1,
  });
  check('alice follow moved', await followedBy(q, U.alice), [P.target]);
  check('bob keeps both follows', await followedBy(q, U.bob), [P.source, P.target]);
  check('person s1 moved', await onProfile(q, 'persons', PERSON.s1), P.target);
  check('person s2 moved', await onProfile(q, 'persons', PERSON.s2), P.target);
  const own = await onProfile(q, 'workshop_instructors', I.sourceOwn);
  check('instructor on own Workshop moved', own, P.target);
  const shared = await onProfile(q, 'workshop_instructors', I.sourceShared);
  check('instructor on shared Workshop stays', shared, P.source);
}

async function checkProfiles(q) {
  const survivor = await profile(q, P.target);
  check('survivor photo filled', survivor.photo_url, 'a.jpg');
  check('survivor bio kept (source blank)', survivor.bio, 'b bio');
  check("survivor '' country filled", survivor.country_code, 'FR');
  check("survivor '' HEMA Ratings id filled", survivor.hema_ratings_id, '123');
  check('survivor NULL gender category filled', survivor.gender_category, 'open');
  check('survivor hides workshops (stricter)', survivor.hide, true);
  check('survivor refuses followers (stricter)', survivor.allow, false);
  check('survivor took the account link', survivor.claim, U.lea);
  const merged = await profile(q, P.source);
  const flags = [merged.merged_into, merged.merged, merged.deleted];
  check('merged profile flagged', flags, [P.target, true, true]);
  check('merged profile released the link', merged.claim, null);
}

async function checkRecord(q) {
  const record = await lastMerge(q, P.source);
  check('merge record', record.payload_json, {
    moved: {
      personIds: [PERSON.s1, PERSON.s2],
      claimUserId: U.lea,
      workshopInstructorIds: [I.sourceOwn],
      directoryFollowerUserIds: [U.alice],
    },
    reason: 'duplicate',
    source: snapshot(P.source),
    target: snapshot(P.target),
  });
  const [head] = await q`SELECT actor_user_id, entity_type FROM audit_log WHERE id = ${record.id}`;
  check(
    'merge record actor and type',
    [head.actor_user_id, head.entity_type],
    [U.actor, 'fighter'],
  );
  return record;
}

async function checkRevert(q, record) {
  await revert(q, record.id);
  check('alice follow back', await followedBy(q, U.alice), [P.source]);
  check('bob follows unchanged', await followedBy(q, U.bob), [P.source, P.target]);
  check('person s1 back', await onProfile(q, 'persons', PERSON.s1), P.source);
  check('person t1 untouched', await onProfile(q, 'persons', PERSON.t1), P.target);
  check('instructor back', await onProfile(q, 'workshop_instructors', I.sourceOwn), P.source);
  const restored = await profile(q, P.source);
  const flags = [restored.merged_into, restored.merged, restored.deleted, restored.reverted];
  check('source restored', flags, [null, false, false, true]);
  check('source has the link back', restored.claim, U.lea);
  const kept = await profile(q, P.target);
  check(
    'survivor stays strict, keeps filled fields, loses the link',
    [kept.hide, kept.allow, kept.photo_url, kept.claim],
    [true, false, 'a.jpg', null],
  );
  const [undo] =
    await q`SELECT payload_json FROM audit_log WHERE action = 'fighter.merge_revert' AND entity_id = ${P.source}`;
  check('revert record', undo?.payload_json, {
    source_id: P.source,
    target_id: P.target,
    reverted_audit_log_id: record.id,
  });
  check('a second revert is refused', await refusal(q, (sp) => revert(sp, record.id)), {
    code: 'P0001',
    message: 'This fighter merge was already reverted',
  });
}

export async function mergeAndRevert(tx) {
  await scenario(tx, async (q) => {
    await checkMoves(q);
    await checkProfiles(q);
    await checkRevert(q, await checkRecord(q));
  });
}

export async function strictSurvivorStaysStrict(tx) {
  await scenario(tx, async (q) => {
    await q`UPDATE global_persons SET hide_workshops_publicly = true WHERE id = ${P.target}`;
    await q`UPDATE global_persons SET hide_workshops_publicly = false WHERE id = ${P.source}`;
    await merge(q, P.source, P.target);
    check('a survivor that hides keeps hiding', (await profile(q, P.target)).hide, true);
  });
}

export async function ownedSurvivorKeepsItsLink(tx) {
  await scenario(tx, async (q) => {
    await q`UPDATE global_persons SET claimed_by_user_id = ${U.max} WHERE id = ${P.target}`;
    await merge(q, P.source, P.target);
    check('owned survivor keeps its owner', (await profile(q, P.target)).claim, U.max);
    check('merged profile keeps its own', (await profile(q, P.source)).claim, U.lea);
    const record = await lastMerge(q, P.source);
    check('no claimUserId in the record', 'claimUserId' in record.payload_json.moved, false);
  });
}

export async function revertMovesBackOnlyWhatIsStillThere(tx) {
  await scenario(tx, async (q) => {
    await merge(q, P.source, P.target);
    const record = await lastMerge(q, P.source);
    // Since the merge: the account unlinked itself, one person was relinked elsewhere, and a
    // follow and an instructor line landed on the merged profile (a write that waited on the
    // merge's lock, checked live before it).
    await q`UPDATE global_persons SET claimed_by_user_id = NULL WHERE id = ${P.target}`;
    await q`UPDATE persons SET global_person_id = ${P.third} WHERE id = ${PERSON.s2}`;
    await q`INSERT INTO directory_follows (follower_user_id, followed_global_person_id)
      VALUES (${U.alice}, ${P.source})`;
    await q`INSERT INTO workshop_instructors (id, workshop_id, global_person_id, display_name)
      VALUES (${id(44)}, ${W.own}, ${P.source}, 'Lea A')`;
    check('the revert still goes through', await refusal(q, (sp) => revert(sp, record.id)), null);
    await revert(q, record.id);
    check('an unlinked account is not linked again', (await profile(q, P.source)).claim, null);
    const relinked = await onProfile(q, 'persons', PERSON.s2);
    check('a relinked person stays where it went', relinked, P.third);
    const still = await onProfile(q, 'persons', PERSON.s1);
    check('a person still on the survivor goes back', still, P.source);
    const doubled = await followedBy(q, U.alice);
    check('a follow doubled since stays on the survivor', doubled, [P.source, P.target]);
    const line = await onProfile(q, 'workshop_instructors', I.sourceOwn);
    check('an instructor line doubled since stays on the survivor', line, P.target);
  });
}

export async function recordBeforeFollowsMoved(tx) {
  await scenario(tx, async (q) => {
    await merge(q, P.source, P.target);
    const record = await lastMerge(q, P.source);
    // A record written before ruling 116 lists no follows: none of them move back.
    await q`UPDATE audit_log SET payload_json = payload_json #- '{moved,directoryFollowerUserIds}'
      WHERE id = ${record.id}`;
    await revert(q, record.id);
    check('a pre-116 record moves no follow back', await followedBy(q, U.alice), [P.target]);
    check('and still moves its people back', await onProfile(q, 'persons', PERSON.s1), P.source);
  });
}

export async function manyFollowsMoveInOneCall(tx) {
  await scenario(tx, async (q) => {
    await q`INSERT INTO directory_follows (follower_user_id, followed_global_person_id)
      SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, ${P.source}
        FROM generate_series(1, ${MANY}) g`;
    await merge(q, P.source, P.target);
    const [{ left }] = await q`SELECT count(*)::int AS left FROM directory_follows
      WHERE followed_global_person_id = ${P.source}`;
    check(`all ${MANY} follows moved (only bob's second one stays)`, left, 1);
    const record = await lastMerge(q, P.source);
    const listed = record.payload_json.moved.directoryFollowerUserIds.length;
    check('the record lists every moved follower', listed, MANY + 1);
  });
}
