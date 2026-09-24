/**
 * The reviewed lists `route-authz.test.ts` holds the API to. Keys are
 * `path#Class.method`, relative to `apps/api/src`.
 *
 * UNDECIDED is a RATCHET. Each line is a route that, on 2026-09-18, reached
 * nothing that can refuse the caller — anyone who can sign up could call it, and
 * most of them anyone at all, because the AuthGuard runs in shadow mode. Fix a
 * route and delete its line;
 * the test goes red on a line whose route now decides, and pins the length, so
 * the list can only shrink. Never add a line to get a new route through: give
 * the route a check, or a `@Public()` that `public-routes.test.ts` then reviews.
 *
 * Prefixes: `write` changes data, `read` returns what is not public, `open`
 * returns what is public anyway and only needs `@Public()` — `open*` must ALSO
 * hide draft Events first. Found by the scan, then read route by route.
 *
 * DECIDED_ELSEWHERE is permanent: routes that do decide, in a way the scan does
 * not count. Each was read, and says how.
 *
 * FALSE_PASSES is the other way round: routes the scan passes that a reading
 * showed are open. The test treats them as undecided, so each is on UNDECIDED
 * too; drop a line once the scan stops passing its route. All three lengths
 * are pinned.
 */
export const UNDECIDED: Readonly<Record<string, string>> = {
  // clubs and platform-wide identities. The writes were fixed 2026-09-23
  // (rulings 36-38, 55, 56); these four reads wait for ruling 15's read pass.
  'modules/clubs/clubs.controller.ts#ClubsController.list': 'open',
  'modules/fighters/fighters.controller.ts#FightersController.list': 'read: unlisted people',
  'modules/fighters/fighters.controller.ts#WeaponsController.list': 'open: web-public calls it',
  'modules/hema-ratings/hema-ratings.controller.ts#HemaRatingsController.search':
    'open: but it fetches upstream',

  // public by nature.
  'modules/fighters/fighters.controller.ts#GlobalPersonsController.list':
    'read: any signed-in account',
  'modules/exports/exports.controller.ts#ExportsController.restorePreview':
    'read: parses only the upload, but for anyone',

  // follows — with no cookie the identity is `{}`, and the service then filters
  // on no follower at all.
  'modules/follows/follows.controller.ts#FollowsController.unfollow':
    "write: anonymous deletes EVERY spectator's follow of the person",
  'modules/follows/follows.controller.ts#FollowsController.updateNotifications':
    "write: anonymous rewrites every follower's settings",
  'modules/follows/follows.controller.ts#FollowsController.follow':
    "write: anonymous gets another follower's row back",

  // FALSE_PASSES, below.
  'modules/phases/phases.controller.ts#PhasesController.generatePools':
    'write: rebuilds any unscored Pool layout',
  'modules/referees/qualifications.controller.ts#QualificationsController.updateSkill':
    'write: the global skill catalogue',
  'modules/auth/me.controller.ts#MeController.searchGlobalPersons':
    "read: other people's unclaimed profiles",
};

export const FALSE_PASSES: Readonly<Record<string, string>> = {
  'modules/phases/phases.controller.ts#PhasesController.generatePools':
    'the org check guards only a forced regeneration that discards scored bouts',
  'modules/referees/qualifications.controller.ts#QualificationsController.updateSkill':
    'the org check runs for custom skills only; a system skill checks nobody',
  'modules/auth/me.controller.ts#MeController.searchGlobalPersons':
    "passes as a `me` route, but reads other people's rows",
};

export const DECIDED_ELSEWHERE: Readonly<Record<string, string>> = {
  // The caller's own rows, on a path with no `me` segment (a `me` route that
  // refuses anonymous callers is recognised on its own).
  'modules/follows/follows.controller.ts#FollowsController.list':
    "the caller's own follows; [] with no identity",
  'modules/notifications/notifications.controller.ts#NotificationsController.getPreferences':
    "the caller's own preferences",
  'modules/notifications/notifications.controller.ts#NotificationsController.updatePreferences':
    "the caller's own preferences",
  'modules/notifications/notifications.controller.ts#NotificationsController.listUserBroadcasts':
    "the caller's own broadcasts",
  'modules/notifications/notifications.controller.ts#NotificationsController.subscribe':
    "the caller's own push subscription",
  'modules/notifications/notifications.controller.ts#NotificationsController.unsubscribe':
    ".eq('user_id', the caller)",
  'modules/compensation/compensation.controller.ts#CompensationController.listPlans':
    "the caller's organisations' plans",
  'modules/leagues/leagues.controller.ts#LeaguesController.listManageable':
    "the caller's own leagues",
  'modules/leagues/leagues.controller.ts#LeaguesController.listAttachable':
    'public leagues, plus each draft the caller manages or whose club is in it; 401 signed out',
  'modules/organizations/organizations.controller.ts#OrganizationsController.create':
    "a new organisation the caller owns; anonymous fails only on the uuid cast of 'anonymous'",
  // A comparison with the caller, then a 403 — inline, so no name to count.
  'modules/fighters/fighters.controller.ts#FightersController.promote':
    'claimed_by_user_id must be the caller',
  'modules/penalties/penalties.controller.ts#PenaltiesController.approveSharing':
    'isPlatformStaffAdmin, else 403',
  'modules/penalties/penalties.controller.ts#PenaltiesController.rejectSharing':
    'isPlatformStaffAdmin, else 403',
  'modules/leagues/league-membership-requests.controller.ts#LeagueMembershipRequestsController.review':
    'platform admin, league admin, or admin of an org with a league role; else 403',
  // Dynamic dispatch: each content type's own assertAccess (org admin, or the
  // fighter's own profile) — no static reading follows `def.assertAccess`.
  'modules/generated-content/generated-content.controller.ts#GeneratedContentController.generate':
    'the content type decides',
  'modules/generated-content/generated-content.controller.ts#GeneratedContentController.get':
    'the content type decides',
  'modules/generated-content/generated-content.controller.ts#GeneratedContentController.publish':
    'the content type decides',
  'modules/generated-content/generated-content.controller.ts#GeneratedContentController.unpublish':
    'the content type decides',
};
