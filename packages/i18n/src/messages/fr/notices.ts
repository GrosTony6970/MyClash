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
    bodyAt: 'Annulé : {workshop}, {when}.',
    yourWorkshop: 'votre atelier',
  },
  workshopMoved: {
    title: 'Atelier déplacé',
    body: 'Nouvel horaire : {workshop}, {when}, {where}.',
    bodyNoPlace: 'Nouvel horaire : {workshop}, {when}.',
    bodyNoTime: "Déplacé : {workshop}. Le nouvel horaire n'est pas encore fixé.",
    yourWorkshop: 'votre atelier',
  },
  waitlistPromoted: {
    title: 'Place en atelier confirmée',
    body: "Vous quittez la liste d'attente : votre place est confirmée pour {workshop}.",
    bodyAt: "Vous quittez la liste d'attente : votre place est confirmée pour {workshop}, {when}.",
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
    hitChanged:
      'Un administrateur a modifié cet échange. Refaites une demande si le nouvel échange est faux lui aussi.',
    boutReset: 'Ce combat a été remis à zéro et sera rejoué : votre demande est close.',
  },
  correctionRequest: {
    noReason: 'Aucune raison donnée',
  },
  correctionApproved: {
    title: 'Demande de correction approuvée',
    body: 'La correction demandée a été faite.',
  },
  sparRequestReceived: {
    title: 'Nouvelle demande de spar',
    body: 'Ouvrez FightBook pour répondre.',
  },
  sparAgreed: {
    title: 'Spar accepté',
    body: 'Votre demande de spar a été acceptée. Elle est dans Mes spars.',
  },
  sparStarting: {
    title: 'Spar bientôt',
    body: 'Votre spar commence dans 10 minutes.',
  },
  sparCancelled: {
    title: 'Spar annulé',
    body: 'Un spar que vous aviez accepté a été annulé.',
  },
  sparFlagRaised: {
    title: 'Un signalement de sécurité à examiner',
    body: 'Un combattant a signalé un problème de sécurité sur un spar.',
  },
  sparMarkedDone: {
    title: 'Un spar a été marqué comme fait',
    body: "Vous pouvez l'annuler jusqu'à deux jours après le jour du spar.",
  },
  sparCallAnswered: {
    title: 'Quelqu’un répond présent à votre appel ouvert',
    body: 'Ouvrez FightBook pour choisir avec qui faire le spar.',
  },
  sparCallPicked: {
    title: 'Votre réponse a été retenue',
    body: 'Le spar est dans Mes spars.',
  },
} as const satisfies DeepString<typeof enNotices>;
