import type { MessageTree } from '../../message-tree.js';

/**
 * The automatic notices the API sends: a phone alert and, for a reader with no
 * push subscription, an email. No browser reads this namespace, so it is in no
 * surface. The API prints each text in French and in English side by side.
 */
export const notices = {
  lock: {
    title: 'Referee assignment updated',
    body: '{role} has been updated.',
    bodyForBout: '{role} for {bout} has been updated.',
    yourDuty: 'Your referee assignment',
  },
  workshopCancelled: {
    title: 'Workshop cancelled',
    body: '{workshop} was cancelled.',
    yourWorkshop: 'Your workshop',
  },
  waitlistPromoted: {
    title: 'Workshop place confirmed',
    body: 'You have been promoted from the waitlist for {workshop}.',
    yourWorkshop: 'Your workshop',
  },
  resultsPublished: {
    title: 'Results published',
    body: '{tournament} results are now published.',
  },
  swissRound: {
    title: '{tournament} — round {round}',
    subject: '{tournament}: round {round} pairings',
    bye: 'You have a bye in round {round}.',
    pairings: 'Round {round} pairings are published.',
    face: 'Round {round}: you face {opponent}.',
    faceOn: 'Round {round}: you face {opponent} on {piste}.',
    nextOpponent: 'your next opponent',
  },
  newEvent: {
    subject: '{organiser} published {event}',
    anOrganiser: 'An organiser',
  },
  matchStarting: {
    title: 'Match starting soon',
    body: '{bout} starts soon.',
    yourMatch: 'Your match',
  },
  workshopStarting: {
    title: 'Workshop starting soon',
    body: '{workshop} starts soon.',
    yourWorkshop: 'Your workshop',
  },
  refereeStarting: {
    title: 'Referee slot starting soon',
    body: '{role} starts soon.',
    bodyForBout: '{role} starts soon for {bout}.',
    yourDuty: 'Your referee assignment',
  },
  followMatch: {
    title: 'Followed fighter starting soon',
    body: '{fighter} fights in {minutes} min - {bout} vs {opponent} on {piste}.',
    aFighter: 'A followed fighter',
    anOpponent: 'an opponent',
    aMatch: 'Match',
    theirPiste: 'their lice',
  },
  followReferee: {
    title: 'Followed referee starting soon',
    body: '{referee} referees in {minutes} min.',
    bodyBout: '{referee} referees in {minutes} min - {bout}.',
    bodyPiste: '{referee} referees in {minutes} min on {piste}.',
    bodyBoutPiste: '{referee} referees in {minutes} min - {bout} on {piste}.',
    aReferee: 'A followed referee',
  },
  followWorkshop: {
    title: 'Followed instructor workshop soon',
    body: '{workshop} with {instructor} starts in {minutes} min.',
    aWorkshop: 'A workshop',
    anInstructor: 'A followed instructor',
  },
  correctionRejected: {
    title: 'Exchange correction rejected',
    hitChanged:
      'An administrator changed this exchange. Ask again if the new exchange is wrong too.',
  },
  correctionApproved: {
    title: 'Exchange correction approved',
    body: 'The correction you asked for was made.',
  },
} as const satisfies MessageTree;
