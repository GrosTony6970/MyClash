import type { DeepString } from '../../message-tree.js';
import type { notices as enNotices } from '../en/notices.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here.
export const notices = {
  lock: {
    title: "Affectation d'arbitrage mise à jour",
    body: 'Mise à jour : {role}.',
    bodyForBout: 'Mise à jour : {role}, {bout}.',
    yourDuty: "votre affectation d'arbitrage",
  },
  workshopCancelled: {
    title: 'Atelier annulé',
    body: 'Annulé : {workshop}.',
    yourWorkshop: 'votre atelier',
  },
  waitlistPromoted: {
    title: 'Place en atelier confirmée',
    body: "Vous quittez la liste d'attente : votre place est confirmée pour {workshop}.",
    yourWorkshop: 'votre atelier',
  },
  resultsPublished: {
    title: 'Résultats publiés',
    body: '{tournament} : les résultats sont publiés.',
  },
  swissRound: {
    title: '{tournament} — ronde {round}',
    subject: '{tournament} : appariements de la ronde {round}',
    bye: "Ronde {round} : vous n'avez pas d'adversaire (exemption).",
    pairings: 'Les appariements de la ronde {round} sont publiés.',
    face: 'Ronde {round} : vous affrontez {opponent}.',
    faceOn: 'Ronde {round} : vous affrontez {opponent} sur {piste}.',
    nextOpponent: 'votre prochain adversaire',
  },
  newEvent: {
    subject: '{organiser} a publié {event}',
    anOrganiser: 'Un organisateur',
  },
  matchStarting: {
    title: 'Combat imminent',
    body: '{bout} commence bientôt.',
    yourMatch: 'Votre combat',
  },
  workshopStarting: {
    title: 'Atelier imminent',
    body: '{workshop} commence bientôt.',
    yourWorkshop: 'Votre atelier',
  },
  refereeStarting: {
    title: 'Arbitrage imminent',
    body: 'Bientôt : {role}.',
    bodyForBout: 'Bientôt : {role}, {bout}.',
    yourDuty: "votre affectation d'arbitrage",
  },
  followMatch: {
    title: 'Un combattant suivi combat bientôt',
    body: '{fighter} combat dans {minutes} min - {bout} contre {opponent} sur {piste}.',
    aFighter: 'Un combattant suivi',
    anOpponent: 'un adversaire',
    aMatch: 'Combat',
    theirPiste: 'sa piste',
  },
  followReferee: {
    title: 'Un arbitre suivi officie bientôt',
    body: '{referee} officie dans {minutes} min.',
    bodyBout: '{referee} officie dans {minutes} min - {bout}.',
    bodyPiste: '{referee} officie dans {minutes} min sur {piste}.',
    bodyBoutPiste: '{referee} officie dans {minutes} min - {bout} sur {piste}.',
    aReferee: 'Un arbitre suivi',
  },
  followWorkshop: {
    title: "L'atelier d'un instructeur suivi commence bientôt",
    body: '{workshop} avec {instructor} commence dans {minutes} min.',
    aWorkshop: 'Un atelier',
    anInstructor: 'un instructeur suivi',
  },
  correctionRejected: {
    title: 'Demande de correction refusée',
  },
} as const satisfies DeepString<typeof enNotices>;
