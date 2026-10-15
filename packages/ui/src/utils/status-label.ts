import type {
  ClaimStatus,
  ClockStatus,
  MatchStatus,
  StaffRole,
  TournamentSideColor,
} from '@myclash/types';
import type { Translator } from '../types/translator';
import type { ColorToken } from './color-token';
import type { TournamentStatus } from './status-pill';

/** `events.status`: the five values of `events_status_check` (pinned by the test). */
export type EventStatus = 'draft' | 'published' | 'running' | 'completed' | 'archived';

/** `registrations.status`: the five values of `registration_status_check` (pinned by the test). */
export type RegistrationStatus =
  'registered' | 'checked_in' | 'withdrawn' | 'disqualified' | 'waitlist';

/**
 * `organization_members.role`. No CHECK: pinned by the test to the ladder of `has_org_role`,
 * the one SQL that names every role.
 */
export type OrgMemberRole =
  'owner' | 'admin' | 'editor' | 'scorekeeper' | 'referee' | 'workshop_lead' | 'read_only';

/**
 * The one word for each state of each domain, in every app (quick win X1, operator ruling
 * 2026-10-14). A screen asks for the KEY and words it with its own `t`: packages/ui never
 * translates by itself, and must not import a message tree.
 *
 * Each map is a `Record` over the domain's union, so a state added to the union does not compile
 * until it has a word; and every key is written whole, so the i18n sweep checks each word both
 * ways (a key with no word, a word nobody asks for).
 */
const MATCH: Record<MatchStatus, string> = {
  scheduled: 'common.status.match.scheduled',
  running: 'common.status.match.running',
  paused: 'common.status.match.paused',
  completed: 'common.status.match.completed',
  voided: 'common.status.match.voided',
};

const CLOCK: Record<ClockStatus, string> = {
  idle: 'common.status.clock.idle',
  running: 'common.status.clock.running',
  halted: 'common.status.clock.halted',
  ended: 'common.status.clock.ended',
};

const EVENT: Record<EventStatus, string> = {
  draft: 'common.status.event.draft',
  published: 'common.status.event.published',
  running: 'common.status.event.running',
  completed: 'common.status.event.completed',
  archived: 'common.status.event.archived',
};

const TOURNAMENT: Record<TournamentStatus, string> = {
  draft: 'common.status.tournament.draft',
  published: 'common.status.tournament.published',
  running: 'common.status.tournament.running',
  completed: 'common.status.tournament.completed',
  archived: 'common.status.tournament.archived',
};

const REGISTRATION: Record<RegistrationStatus, string> = {
  registered: 'common.status.registration.registered',
  checked_in: 'common.status.registration.checked_in',
  withdrawn: 'common.status.registration.withdrawn',
  disqualified: 'common.status.registration.disqualified',
  waitlist: 'common.status.registration.waitlist',
};

const CLAIM: Record<ClaimStatus, string> = {
  unclaimed: 'common.status.claim.unclaimed',
  guest_active: 'common.status.claim.guest_active',
  claimed: 'common.status.claim.claimed',
};

// Roles say the words of docs/HIERARCHY.md: `workshop_lead` is an Instructor.
const ORG_ROLE: Record<OrgMemberRole, string> = {
  owner: 'common.status.orgRole.owner',
  admin: 'common.status.orgRole.admin',
  editor: 'common.status.orgRole.editor',
  scorekeeper: 'common.status.orgRole.scorekeeper',
  referee: 'common.status.orgRole.referee',
  workshop_lead: 'common.status.orgRole.workshop_lead',
  read_only: 'common.status.orgRole.read_only',
};

const STAFF_ROLE: Record<StaffRole, string> = {
  scoring: 'common.status.staffRole.scoring',
  checkin: 'common.status.staffRole.checkin',
  gear: 'common.status.staffRole.gear',
};

// The words a screen showed raw before X1 (operator ruling 2026-10-15), each over its own
// list of values: a Swiss round, a Pool's standings, an AI draft, a data scan, a League's
// roles and attachments, a person's part at an Event, a referee's assignment, a colour.
type SwissRoundStatus = 'pending' | 'running' | 'completed';
type PoolState = 'in_progress' | 'completed';
type AiDraftStatus = 'draft' | 'ready' | 'failed' | 'applied' | 'rejected';
type ScanStatus = 'running' | 'completed' | 'failed';
type LeagueUserRole = 'owner' | 'admin';
type LeagueOrgRole = 'owner' | 'admin' | 'member';
type LeagueAttachmentStatus = 'requested' | 'approved' | 'rejected' | 'removed';
type PersonRole = 'competitor' | 'referee' | 'workshop_lead';
type RefereeAssignmentStatus = 'assigned' | 'pending' | 'confirmed';
type BracketSlotStatus = 'pending' | 'ready' | 'running' | 'completed' | 'forfeit' | 'disqualified';

const SWISS_ROUND: Record<SwissRoundStatus, string> = {
  pending: 'common.status.swissRound.pending',
  running: 'common.status.swissRound.running',
  completed: 'common.status.swissRound.completed',
};

const POOL_STATE: Record<PoolState, string> = {
  in_progress: 'common.status.poolState.in_progress',
  completed: 'common.status.poolState.completed',
};

const AI_DRAFT: Record<AiDraftStatus, string> = {
  draft: 'common.status.aiDraft.draft',
  ready: 'common.status.aiDraft.ready',
  failed: 'common.status.aiDraft.failed',
  applied: 'common.status.aiDraft.applied',
  rejected: 'common.status.aiDraft.rejected',
};

const SCAN: Record<ScanStatus, string> = {
  running: 'common.status.scan.running',
  completed: 'common.status.scan.completed',
  failed: 'common.status.scan.failed',
};

const LEAGUE_USER_ROLE: Record<LeagueUserRole, string> = {
  owner: 'common.status.leagueUserRole.owner',
  admin: 'common.status.leagueUserRole.admin',
};

const LEAGUE_ORG_ROLE: Record<LeagueOrgRole, string> = {
  owner: 'common.status.leagueOrgRole.owner',
  admin: 'common.status.leagueOrgRole.admin',
  member: 'common.status.leagueOrgRole.member',
};

const LEAGUE_ATTACHMENT: Record<LeagueAttachmentStatus, string> = {
  requested: 'common.status.leagueAttachment.requested',
  approved: 'common.status.leagueAttachment.approved',
  rejected: 'common.status.leagueAttachment.rejected',
  removed: 'common.status.leagueAttachment.removed',
};

const PERSON_ROLE: Record<PersonRole, string> = {
  competitor: 'common.status.personRole.competitor',
  referee: 'common.status.personRole.referee',
  workshop_lead: 'common.status.personRole.workshop_lead',
};

const REFEREE_ASSIGNMENT: Record<RefereeAssignmentStatus, string> = {
  assigned: 'common.status.refereeAssignment.assigned',
  pending: 'common.status.refereeAssignment.pending',
  confirmed: 'common.status.refereeAssignment.confirmed',
};

const BRACKET_SLOT: Record<BracketSlotStatus, string> = {
  pending: 'common.status.bracketSlot.pending',
  ready: 'common.status.bracketSlot.ready',
  running: 'common.status.bracketSlot.running',
  completed: 'common.status.bracketSlot.completed',
  forfeit: 'common.status.bracketSlot.forfeit',
  disqualified: 'common.status.bracketSlot.disqualified',
};

// A colour's name: every ColorToken and every side colour a Tournament may pick.
const COLOR: Record<ColorToken | TournamentSideColor, string> = {
  red: 'common.status.color.red',
  blue: 'common.status.color.blue',
  green: 'common.status.color.green',
  yellow: 'common.status.color.yellow',
  purple: 'common.status.color.purple',
  orange: 'common.status.color.orange',
  black: 'common.status.color.black',
  white: 'common.status.color.white',
  amber: 'common.status.color.amber',
  violet: 'common.status.color.violet',
  teal: 'common.status.color.teal',
  gold: 'common.status.color.gold',
  silver: 'common.status.color.silver',
  bronze: 'common.status.color.bronze',
  slate: 'common.status.color.slate',
  grey: 'common.status.color.grey',
  brown: 'common.status.color.brown',
  pink: 'common.status.color.pink',
};

const STATUS_LABEL_KEYS = {
  match: MATCH,
  clock: CLOCK,
  event: EVENT,
  tournament: TOURNAMENT,
  registration: REGISTRATION,
  claim: CLAIM,
  orgRole: ORG_ROLE,
  staffRole: STAFF_ROLE,
  swissRound: SWISS_ROUND,
  poolState: POOL_STATE,
  aiDraft: AI_DRAFT,
  scan: SCAN,
  leagueUserRole: LEAGUE_USER_ROLE,
  leagueOrgRole: LEAGUE_ORG_ROLE,
  leagueAttachment: LEAGUE_ATTACHMENT,
  personRole: PERSON_ROLE,
  refereeAssignment: REFEREE_ASSIGNMENT,
  color: COLOR,
  bracketSlot: BRACKET_SLOT,
} as const;

export type StatusLabelDomain = keyof typeof STATUS_LABEL_KEYS;
export type StatusOf<Domain extends StatusLabelDomain> = keyof (typeof STATUS_LABEL_KEYS)[Domain];

/** The i18n key of one state's word. */
export function statusLabelKey<Domain extends StatusLabelDomain>(
  domain: Domain,
  status: StatusOf<Domain>,
): string {
  return (STATUS_LABEL_KEYS[domain] as Record<PropertyKey, string>)[status]!;
}

/** True when the domain has a word for this value, read as a plain string. */
export function isKnownStatus<Domain extends StatusLabelDomain>(
  domain: Domain,
  status: string,
): status is StatusOf<Domain> & string {
  return Object.hasOwn(STATUS_LABEL_KEYS[domain], status);
}

/**
 * The word of a state read as a plain string (an API row). A value the domain does not know (a
 * state the database gained after this build) is shown as it is: the maps are pinned to the
 * column's CHECK list by their tests, so only a new state can reach this branch.
 */
export function statusLabel(domain: StatusLabelDomain, status: string, t: Translator): string {
  return isKnownStatus(domain, status) ? t(statusLabelKey(domain, status)) : status;
}
