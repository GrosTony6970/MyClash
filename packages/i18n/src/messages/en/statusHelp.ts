import type { MessageTree } from '../../message-tree.js';

export const statusHelp = {
  triggerLabel: 'What this status means',
  fields: {
    means: 'What it means',
    next: 'What happens next',
    who: 'Who can change it',
  },
  event: {
    draft: {
      means: 'The event exists but nothing about it is on the public site.',
      next: 'Publishing it makes it visible and lets people find and enter it.',
      who: 'An organisation admin or owner.',
    },
    published: {
      means: 'The event is live on the public site and open to the world.',
      next: 'It becomes running on its start date, or you can set it back to draft.',
      who: 'An organisation admin or owner.',
    },
    running: {
      means: 'The event is under way. Scoring, schedule and live boards are active.',
      next: 'It moves to completed once the fighting is over.',
      who: 'An organisation admin or owner.',
    },
    completed: {
      means: 'The event has finished. Results and rankings are final.',
      next: 'Nothing further, unless you archive it to clear it out of the way.',
      who: 'An organisation admin or owner.',
    },
    archived: {
      means:
        'The event is closed and read-only. It stays visible publicly but nothing can be edited.',
      next: 'It stays as it is. Deleting it needs a deletion request.',
      who: 'An organisation admin or owner.',
    },
  },
  tournament: {
    draft: {
      means: 'This tournament is hidden, even if the event itself is published.',
      next: 'Publishing it shows it on the event page and opens registration.',
      who: 'An organisation admin or owner.',
    },
    published: {
      means: 'The tournament is visible on the event page and accepting entries.',
      next: 'Generate the pools and bracket, then start fighting.',
      who: 'An organisation admin or owner.',
    },
    running: {
      means: 'Fights are being scored in this tournament right now.',
      next: 'It moves to completed when the final has been fought.',
      who: 'An organisation admin or owner.',
    },
    completed: {
      means: 'Every fight is done and the final ranking is settled.',
      next: 'The results feed fighter statistics and any league it belongs to.',
      who: 'An organisation admin or owner.',
    },
    archived: {
      means: 'The tournament is read-only and no longer part of day-to-day work.',
      next: 'It stays as it is, with its results intact.',
      who: 'An organisation admin or owner.',
    },
  },
  match: {
    scheduled: {
      means: 'The fight exists and is waiting. It may or may not have a piste and a time yet.',
      next: 'A scorekeeper opens it on a piste and starts the clock.',
      who: 'An organiser assigns the piste and time; a scorekeeper starts it.',
    },
    running: {
      means: 'The clock is going and exchanges are being recorded.',
      next: 'It pauses between exchanges, and completes when the bout ends.',
      who: 'The scorekeeper on that piste.',
    },
    paused: {
      means: 'The fight has started but the clock is halted — a break, a discussion, a card.',
      next: 'The scorekeeper restarts the clock or ends the fight.',
      who: 'The scorekeeper on that piste.',
    },
    completed: {
      means: 'The fight is over and its score counts towards the standings.',
      next: 'Nothing, unless an organiser corrects it. Corrections are recorded.',
      who: 'An organiser, through a match correction.',
    },
    voided: {
      means: 'The fight has been cancelled and counts for nobody.',
      next: 'It stays out of the standings. A replacement fight has to be created.',
      who: 'An organiser.',
    },
  },
  workshop: {
    draft: {
      means: 'The workshop is not shown on the event page yet.',
      next: 'Publishing it opens it for enrolment.',
      who: 'An organisation admin or owner.',
    },
    published: {
      means: 'The workshop is listed publicly and people can enrol.',
      next: 'It runs at its scheduled time.',
      who: 'An organisation admin or owner.',
    },
    running: {
      means: 'The workshop is happening now.',
      next: 'It moves to completed when the session ends.',
      who: 'An organisation admin or owner.',
    },
    completed: {
      means: 'The workshop has finished.',
      next: 'Nothing further. Attendance stays on record.',
      who: 'An organisation admin or owner.',
    },
    cancelled: {
      means: 'The workshop will not take place.',
      next: 'Enrolled people keep the record but the session will not run.',
      who: 'An organisation admin or owner.',
    },
  },
  registration: {
    registered: {
      means: 'The fighter has a confirmed place in this tournament.',
      next: 'They check in on the day, then get drawn into a pool.',
      who: 'An organiser, or the fighter withdrawing themselves.',
    },
    checked_in: {
      means: 'The fighter has physically arrived and been checked in.',
      next: 'They are ready to be drawn and to fight.',
      who: 'Anyone on the check-in desk.',
    },
    waitlist: {
      means: 'The tournament is full, so the fighter is holding a numbered place in the queue.',
      next: 'They move up automatically as places free, in waitlist order.',
      who: 'An organiser, or the fighter withdrawing themselves.',
    },
    withdrawn: {
      means: 'The fighter has pulled out. They count for nothing in the standings.',
      next: 'Their place can be given to the first person on the waitlist.',
      who: 'An organiser, or the fighter themselves.',
    },
    disqualified: {
      means: 'The fighter has been removed from the tournament by decision.',
      next: 'Their remaining fights are not scored and they hold no ranking.',
      who: 'An organiser.',
    },
  },
  review: {
    pending: {
      means: 'Waiting for somebody to look at it. Nothing has been decided.',
      next: 'A reviewer approves or rejects it.',
      who: 'Whoever holds the review queue for this kind of request.',
    },
    requested: {
      means: 'Somebody has asked for this and it is waiting on a decision.',
      next: 'A reviewer approves or rejects it.',
      who: 'Whoever holds the review queue for this kind of request.',
    },
    approved: {
      means: 'The request was accepted.',
      next: 'The change it asked for is now in force.',
      who: 'A reviewer, though reversing it usually needs a new request.',
    },
    linked: {
      means: 'The request was accepted and joined to an existing record.',
      next: 'The two are now the same thing everywhere.',
      who: 'A reviewer.',
    },
    rejected: {
      means: 'The request was turned down.',
      next: 'Nothing changes. A fresh request can be made.',
      who: 'A reviewer.',
    },
    cancelled: {
      means: 'The request was called off before anyone decided on it.',
      next: 'Nothing changes.',
      who: 'Whoever made the request.',
    },
    withdrawn: {
      means: 'The person who asked has taken the request back.',
      next: 'Nothing changes.',
      who: 'Whoever made the request.',
    },
  },
  phaseVisibility: {
    hidden: {
      means: 'This phase is not shown on the public event page.',
      next: 'Publishing it lets spectators follow the pools or bracket live.',
      who: 'An organisation admin or owner.',
    },
    published: {
      means: 'Spectators can see this phase, including scores as they land.',
      next: 'You can hide it again at any point.',
      who: 'An organisation admin or owner.',
    },
  },
  clock: {
    idle: {
      means: 'The clock has not been started for this fight.',
      next: 'Starting it begins the bout and the recorded time.',
      who: 'The scorekeeper on that piste.',
    },
    running: {
      means: 'Fight time is counting down.',
      next: 'It halts between exchanges, or runs out and ends the bout.',
      who: 'The scorekeeper on that piste.',
    },
    halted: {
      means: 'The clock is stopped mid-fight. Time is not counting.',
      next: 'The scorekeeper restarts it or ends the fight.',
      who: 'The scorekeeper on that piste.',
    },
    ended: {
      means: 'Fight time is used up.',
      next: 'The result stands on the score at the moment time ran out.',
      who: 'Nobody — this is what the clock reaching zero means.',
    },
  },
  ruleset: {
    builtin: {
      means: 'One of the rulesets that ships with MyClash. It cannot be edited.',
      next: 'Fork it if you want to change something; your copy is yours to edit.',
      who: 'Anyone who can manage rulesets for the organisation.',
    },
    default: {
      means: 'The ruleset used when a tournament does not pin one of its own.',
      next: 'Pin a different ruleset on the tournament to override it.',
      who: 'Anyone who can manage the tournament.',
    },
    custom: {
      means: 'A ruleset your organisation wrote or forked.',
      next: 'Publish it to make it usable on tournaments.',
      who: 'Anyone who can manage rulesets for the organisation.',
    },
    draft: {
      means: 'Still being written. It cannot be pinned to a tournament yet.',
      next: 'Publishing it validates the rules and makes it selectable.',
      who: 'Anyone who can manage rulesets for the organisation.',
    },
    pendingReview: {
      means: 'Submitted for review, waiting on a decision before it can be shared.',
      next: 'A reviewer approves it or sends it back.',
      who: 'A MyClash reviewer.',
    },
    published: {
      means: 'Finished and usable. Tournaments can pin it, and its content is frozen.',
      next: 'Editing it means publishing a new version; pinned tournaments keep the old one.',
      who: 'Anyone who can manage rulesets for the organisation.',
    },
    archived: {
      means: 'Withdrawn from the pickers, but NOT deleted.',
      next: 'Tournaments that already pinned it keep scoring by it, forever.',
      who: 'Anyone who can manage rulesets for the organisation.',
    },
  },
  organization: {
    active: {
      means: 'The organisation is operating normally.',
      next: 'Nothing. This is the ordinary state.',
      who: 'A MyClash super admin.',
    },
    suspended: {
      means: 'The organisation has been stopped by MyClash. Its people cannot work in it.',
      next: 'It stays suspended until a super admin lifts it.',
      who: 'A MyClash super admin.',
    },
  },
} as const satisfies MessageTree;
