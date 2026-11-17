# HEMA terminology glossary

Working glossary for translation and consistent in-app copy. Reviewed by the project owner (native French speaker).

This file is the **single home for EN↔FR terminology**. [`../HIERARCHY.md`](../HIERARCHY.md) defines
what the structural terms _mean_ and is authoritative for that; it used to carry a second French
table, which is now merged here.

## Structural vocabulary

These are the terms [`../HIERARCHY.md`](../HIERARCHY.md) defines. Translate them consistently — they
name the same things in the UI, the docs and the code.

| English                     | French                           | Notes                                                                                                                                                                     |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization                | Organisation / Club organisateur |                                                                                                                                                                           |
| Event                       | Événement                        | The gathering                                                                                                                                                             |
| Event day                   | Journée de l'événement           | Measured on the event's timezone, never the browser's                                                                                                                     |
| Tournament                  | Tournoi                          | A competition inside an event                                                                                                                                             |
| Phase                       | Phase                            | A stage of a tournament: poules, tableau or rondes suisses                                                                                                                |
| Pool                        | Poule                            | Round-robin group                                                                                                                                                         |
| Bracket                     | Tableau / Tableau d'élimination  | The slot tree of an elimination phase                                                                                                                                     |
| Swiss round                 | Ronde suisse                     |                                                                                                                                                                           |
| Match                       | Assaut                           | "Match" also acceptable depending on context                                                                                                                              |
| Exchange                    | Échange                          | The atomic scoring unit                                                                                                                                                   |
| Card                        | Carton                           | A penalty: carton jaune, rouge, noir                                                                                                                                      |
| Protest                     | Réclamation                      | A fighter disputes the referee's call; counted, never scored                                                                                                              |
| Round                       | Manche                           | One round of a best-of-N Match. Not a Swiss round (_ronde_)                                                                                                               |
| Forfeit                     | Forfait                          |                                                                                                                                                                           |
| League                      | Ligue                            | Standings across Events                                                                                                                                                   |
| Workshop                    | Atelier / Stage                  | "Atelier" for short, "stage" for full-day                                                                                                                                 |
| Waiting list                | Liste d'attente                  | Of a Workshop session                                                                                                                                                     |
| Venue                       | Lieu / Salle                     |                                                                                                                                                                           |
| Lice                        | Lice                             | The fighting area a match is held on                                                                                                                                      |
| **Fighter**                 | **Combattant**                   | The canonical word for the competing role                                                                                                                                 |
| Competitor                  | Compétiteur                      | Formal synonym of Fighter — prefer _Fighter/Combattant_                                                                                                                   |
| _(Fighter, FR input alias)_ | Tireur                           | **Not used in UI copy** — the interface says _Combattant_ throughout. Kept only as an accepted **input** alias in the AI tournament-query matcher, because users type it. |
| Global Person               | Personne globale                 | Cross-event identity; internal term, rarely user-facing                                                                                                                   |
| Person                      | Personne                         | Per-event identity                                                                                                                                                        |
| Registration                | Inscription                      | A person entered in one tournament                                                                                                                                        |

## Roles and Event-day jobs

The stored role lists of [`../HIERARCHY.md`](../HIERARCHY.md), as the French UI shows them
(`packages/i18n/src/messages/fr/common.ts`).

| English                | French               | Notes                                     |
| ---------------------- | -------------------- | ----------------------------------------- |
| Owner                  | Propriétaire         | Organization role                         |
| Administrator          | Administrateur       | Organization role                         |
| Editor                 | Éditeur              | Organization role                         |
| Scorekeeper            | Teneur de score      | Organization role                         |
| Referee                | Arbitre              | Organization role                         |
| Instructor             | Instructeur          | Organization role, stored `workshop_lead` |
| Read only              | Lecture seule        | Organization role                         |
| Scoring (staff job)    | Scoring              | Kept in English in the French UI          |
| Check-in (staff job)   | Accueil              | The desk at the door                      |
| Gear check (staff job) | Contrôle du matériel |                                           |
| Photos (staff job)     | Photos               |                                           |

## FightBook

| English                 | French                               | Notes                                    |
| ----------------------- | ------------------------------------ | ---------------------------------------- |
| FightBook               | FightBook                            | A name; not translated                   |
| Spar                    | Spar                                 | Kept in English: "Mes spars"             |
| Ask for a spar          | Proposer un spar                     |                                          |
| Open call               | Appel ouvert                         |                                          |
| Free to spar now        | Disponible pour combattre maintenant |                                          |
| Favourites              | Favoris                              |                                          |
| Block                   | Bloquer                              |                                          |
| Report a safety problem | Signaler un problème de sécurité     | The safety flag, as the fighter reads it |
| At most N spars a day   | Au plus N spars par jour             | The daily limit                          |

## HEMA terminology

Weapons, techniques and officiating. The structural terms above are deliberately not repeated here.

| English                | French                          | Notes                 |
| ---------------------- | ------------------------------- | --------------------- |
| Clean hit              | Touche propre                   |                       |
| Afterblow              | Afterblow                       |                       |
| Double                 | Double                          |                       |
| Longsword              | Épée longue / Épée à deux mains |                       |
| Sidesword / side sword | Épée de côté                    |                       |
| Sabre                  | Sabre                           |                       |
| Spear                  | Lance                           |                       |
| Sword & buckler        | Épée et bocle                   |                       |
| Rapier                 | Rapière                         |                       |
| Dagger                 | Dague                           |                       |
| Wrestling              | Lutte                           |                       |
| Half-sword             | Demi-épée                       |                       |
| Murder stroke          | Mortschlag                      |                       |
| Arbitre déclarant      | (kept in French)                | Lead/Director referee |
| Arbitre assesseur      | (kept in French)                | Assessor referee      |
| Arbitre de table       | (kept in French)                | Table referee         |
| Instructor             | Instructeur                     |                       |

## Referee assignment

The levels [`../HIERARCHY.md`](../HIERARCHY.md) defines for "may this person referee here?".

| English     | French      | Notes                                       |
| ----------- | ----------- | ------------------------------------------- |
| Impossible  | Impossible  | No setting, no override                     |
| Discouraged | Déconseillé | The organiser may go ahead after confirming |

This is a starting point. Add entries as they come up during translation work.
