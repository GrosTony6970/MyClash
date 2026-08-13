import type { DeepString } from '../../message-tree.js';
import type { statusHelp as enStatusHelp } from '../en/statusHelp.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const statusHelp = {
  triggerLabel: 'Ce que signifie ce statut',
  fields: {
    means: 'Ce que cela veut dire',
    next: 'Ce qui se passe ensuite',
    who: 'Qui peut le changer',
  },
  event: {
    draft: {
      means: "L'evenement existe mais rien n'apparait sur le site public.",
      next: 'Le publier le rend visible et permet aux gens de le trouver et de s y inscrire.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    published: {
      means: "L'evenement est en ligne sur le site public, ouvert a tous.",
      next: 'Il passe en cours a sa date de debut, ou vous pouvez le repasser en brouillon.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    running: {
      means: "L'evenement est en cours. Score, planning et affichage live sont actifs.",
      next: 'Il passe a termine une fois les combats finis.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    completed: {
      means: "L'evenement est fini. Resultats et classements sont definitifs.",
      next: 'Plus rien, sauf si vous l archivez pour le ranger.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    archived: {
      means:
        "L'evenement est clos et en lecture seule. Il reste visible publiquement mais rien n'est modifiable.",
      next: 'Il reste en l etat. Le supprimer demande une demande de suppression.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
  },
  tournament: {
    draft: {
      means: "Ce tournoi est masque, meme si l'evenement est publie.",
      next: "Le publier l'affiche sur la page de l'evenement et ouvre les inscriptions.",
      who: "Un admin ou proprietaire de l'organisation.",
    },
    published: {
      means: "Le tournoi est visible sur la page de l'evenement et accepte les inscriptions.",
      next: 'Generez les poules et le tableau, puis lancez les combats.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    running: {
      means: 'Des combats sont en train d etre scores dans ce tournoi.',
      next: 'Il passe a termine quand la finale a ete combattue.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    completed: {
      means: 'Tous les combats sont faits et le classement final est etabli.',
      next: 'Les resultats alimentent les statistiques des combattants et la ligue eventuelle.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    archived: {
      means: 'Le tournoi est en lecture seule et sort du travail courant.',
      next: 'Il reste en l etat, resultats compris.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
  },
  match: {
    scheduled: {
      means: 'Le combat existe et attend. Il a ou non une piste et un horaire.',
      next: 'Un teneur de score l ouvre sur une piste et lance le chrono.',
      who: 'Un organisateur attribue piste et horaire ; un teneur de score le lance.',
    },
    running: {
      means: 'Le chrono tourne et les echanges sont enregistres.',
      next: 'Il se met en pause entre les echanges, et se termine a la fin de l assaut.',
      who: 'Le teneur de score de cette piste.',
    },
    paused: {
      means: 'Le combat a commence mais le chrono est arrete - pause, discussion, carton.',
      next: 'Le teneur de score relance le chrono ou termine le combat.',
      who: 'Le teneur de score de cette piste.',
    },
    completed: {
      means: 'Le combat est fini et son score compte pour le classement.',
      next: 'Plus rien, sauf correction par un organisateur. Les corrections sont tracees.',
      who: 'Un organisateur, via une correction de match.',
    },
    voided: {
      means: 'Le combat a ete annule et ne compte pour personne.',
      next: 'Il reste hors du classement. Il faut creer un combat de remplacement.',
      who: 'Un organisateur.',
    },
  },
  workshop: {
    draft: {
      means: "L'atelier n'apparait pas encore sur la page de l'evenement.",
      next: 'Le publier ouvre les inscriptions.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    published: {
      means: "L'atelier est visible publiquement et les gens peuvent s'y inscrire.",
      next: 'Il se deroule a l horaire prevu.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    running: {
      means: "L'atelier a lieu en ce moment.",
      next: 'Il passe a termine a la fin de la seance.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    completed: {
      means: "L'atelier est termine.",
      next: 'Plus rien. La presence reste enregistree.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    cancelled: {
      means: "L'atelier n'aura pas lieu.",
      next: 'Les inscrits gardent la trace mais la seance ne se tiendra pas.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
  },
  registration: {
    registered: {
      means: 'Le combattant a une place confirmee dans ce tournoi.',
      next: 'Il pointe le jour J, puis est tire dans une poule.',
      who: 'Un organisateur, ou le combattant qui se retire.',
    },
    checked_in: {
      means: 'Le combattant est arrive sur place et a ete pointe.',
      next: 'Il est pret a etre tire et a combattre.',
      who: "Toute personne au bureau d'accueil.",
    },
    waitlist: {
      means: 'Le tournoi est plein, le combattant occupe une place numerotee dans la file.',
      next: 'Il remonte automatiquement des qu une place se libere, dans l ordre de la file.',
      who: 'Un organisateur, ou le combattant qui se retire.',
    },
    withdrawn: {
      means: 'Le combattant s est retire. Il ne compte pour rien au classement.',
      next: 'Sa place peut aller au premier de la liste d attente.',
      who: 'Un organisateur, ou le combattant lui-meme.',
    },
    disqualified: {
      means: 'Le combattant a ete exclu du tournoi par decision.',
      next: 'Ses combats restants ne sont pas scores et il n a aucun classement.',
      who: 'Un organisateur.',
    },
  },
  review: {
    pending: {
      means: 'En attente de relecture. Rien n a ete decide.',
      next: 'Un relecteur approuve ou refuse.',
      who: 'Celui qui tient la file de relecture pour ce type de demande.',
    },
    requested: {
      means: 'Quelqu un a fait cette demande et elle attend une decision.',
      next: 'Un relecteur approuve ou refuse.',
      who: 'Celui qui tient la file de relecture pour ce type de demande.',
    },
    approved: {
      means: 'La demande a ete acceptee.',
      next: 'Le changement demande est desormais en vigueur.',
      who: 'Un relecteur, mais revenir dessus demande en general une nouvelle demande.',
    },
    linked: {
      means: 'La demande a ete acceptee et rattachee a une fiche existante.',
      next: 'Les deux ne font plus qu un partout.',
      who: 'Un relecteur.',
    },
    rejected: {
      means: 'La demande a ete refusee.',
      next: 'Rien ne change. Une nouvelle demande reste possible.',
      who: 'Un relecteur.',
    },
    cancelled: {
      means: 'La demande a ete annulee avant toute decision.',
      next: 'Rien ne change.',
      who: 'Celui qui a fait la demande.',
    },
    withdrawn: {
      means: 'Le demandeur a retire sa demande.',
      next: 'Rien ne change.',
      who: 'Celui qui a fait la demande.',
    },
  },
  phaseVisibility: {
    hidden: {
      means: "Cette phase n'apparait pas sur la page publique de l'evenement.",
      next: 'La publier permet au public de suivre les poules ou le tableau en direct.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
    published: {
      means: 'Le public voit cette phase, scores compris au fil des combats.',
      next: 'Vous pouvez la masquer de nouveau a tout moment.',
      who: "Un admin ou proprietaire de l'organisation.",
    },
  },
  clock: {
    idle: {
      means: "Le chrono n'a pas ete lance pour ce combat.",
      next: 'Le lancer demarre l assaut et le temps enregistre.',
      who: 'Le teneur de score de cette piste.',
    },
    running: {
      means: 'Le temps de combat s ecoule.',
      next: 'Il s arrete entre les echanges, ou arrive a zero et termine l assaut.',
      who: 'Le teneur de score de cette piste.',
    },
    halted: {
      means: 'Le chrono est arrete en plein combat. Le temps ne defile pas.',
      next: 'Le teneur de score le relance ou termine le combat.',
      who: 'Le teneur de score de cette piste.',
    },
    ended: {
      means: 'Le temps de combat est epuise.',
      next: 'Le resultat tient au score obtenu a l instant ou le temps s est termine.',
      who: 'Personne - c est ce que veut dire un chrono arrive a zero.',
    },
  },
  ruleset: {
    builtin: {
      means: 'Un des reglements livres avec MyClash. Il n est pas modifiable.',
      next: 'Forkez-le pour changer quelque chose ; votre copie vous appartient.',
      who: "Toute personne pouvant gerer les reglements de l'organisation.",
    },
    default: {
      means: "Le reglement utilise quand un tournoi n'en fixe aucun.",
      next: 'Fixez un autre reglement sur le tournoi pour le remplacer.',
      who: 'Toute personne pouvant gerer le tournoi.',
    },
    custom: {
      means: 'Un reglement ecrit ou forke par votre organisation.',
      next: 'Publiez-le pour pouvoir l utiliser sur des tournois.',
      who: "Toute personne pouvant gerer les reglements de l'organisation.",
    },
    draft: {
      means: 'Encore en cours d ecriture. Il ne peut pas encore etre fixe sur un tournoi.',
      next: 'Le publier valide les regles et le rend selectionnable.',
      who: "Toute personne pouvant gerer les reglements de l'organisation.",
    },
    pendingReview: {
      means: 'Soumis a relecture, en attente d une decision avant partage.',
      next: 'Un relecteur l approuve ou le renvoie.',
      who: 'Un relecteur MyClash.',
    },
    published: {
      means: 'Termine et utilisable. Les tournois peuvent le fixer, et son contenu est gele.',
      next: 'Le modifier revient a publier une nouvelle version ; les tournois deja fixes gardent l ancienne.',
      who: "Toute personne pouvant gerer les reglements de l'organisation.",
    },
    archived: {
      means: 'Retire des selecteurs, mais PAS supprime.',
      next: 'Les tournois qui l ont deja fixe continuent de scorer avec, pour toujours.',
      who: "Toute personne pouvant gerer les reglements de l'organisation.",
    },
  },
  organization: {
    active: {
      means: "L'organisation fonctionne normalement.",
      next: 'Rien. C est l etat ordinaire.',
      who: 'Un super admin MyClash.',
    },
    suspended: {
      means:
        "L'organisation a ete suspendue par MyClash. Ses membres ne peuvent plus y travailler.",
      next: 'Elle reste suspendue jusqu a ce qu un super admin la reactive.',
      who: 'Un super admin MyClash.',
    },
  },
} as const satisfies DeepString<typeof enStatusHelp>;
