---
title: Référence de la tablette
description: 'Chaque commande de la tablette de score, quand elle est disponible, ce qu’elle permet, et ce qui demande le réseau.'
order: 17
section: pad
---

**Ce que vous allez apprendre :** chaque commande de la tablette de score, dans quel état du
combat elle marche, et que faire quand quelque chose se passe mal. Pour former un bénévole,
commencez par la [Fiche du marqueur](/guide/scorekeeper-sheet).

## Se connecter

- Le lien **Connexion staff** de votre événement ouvre le formulaire avec l'événement déjà rempli.
  Le lien propre à un compte remplit aussi son **Identifiant** : le bénévole ne saisit que le
  **PIN**.
- Sans le lien, la tablette affiche une liste d'événements où choisir.
- Un organisateur peut se connecter avec son propre compte (le formulaire par e-mail, sous celui
  du PIN) : avec le rôle **Teneur de score** ou plus, il marque n'importe quelle lice, sans PIN.
- **Vos lices** liste les lices du compte. **S'entraîner hors ligne**, sur cette page, lance un
  exercice de deux minutes sans réseau ; il est refusé tant que la tablette a encore quelque chose
  à envoyer.
- La page d'une lice montre le combat en cours, les cinq prochains combats, puis tous les combats
  de la lice.

## L'écran du combat

En haut : **Retour à la liste des assauts**, le combat précédent et le suivant de la lice, le code
du combat, le tournoi, la phase et la lice, les deux combattants, leur contrôle du matériel, et
**Actions du match**. Le bouton de thème passe de Hybride à Sombre puis à Clair.

![La tablette pendant que le chrono tourne](../../../assets/guide/13-pad-running.png)

## Ce qui marche dans quel état

| Commande                                                            | Pas commencé             | Chrono en cours | En pause                                                           | Terminé                                  |
| ------------------------------------------------------------------- | ------------------------ | --------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Bouton principal du chrono                                          | **Démarrer**             | **Pause**       | **Reprendre**                                                      | **Rouvrir le match** (demande le réseau) |
| **Terminer le match** (ou **Terminer la manche**)                   | —                        | oui             | oui                                                                | —                                        |
| **Réinitialiser** (le chrono seulement, demande d'abord)            | —                        | —               | oui, jusqu'à la prolongation ou la mort subite (demande le réseau) | —                                        |
| **Touche propre**, **Contre-frappe**, **Double**, **Aucun échange** | éteints                  | _éteints_       | oui                                                                | éteints                                  |
| Pénalités                                                           | éteintes                 | oui             | oui                                                                | éteintes                                 |
| Réclamations                                                        | éteintes                 | oui             | oui                                                                | oui                                      |
| **Annuler la dernière saisie**                                      | dès qu'une saisie existe |                 |                                                                    |                                          |

Les boutons d'échange sont éteints pendant que le chrono tourne : l'arbitre arrête, le marqueur
met en pause, saisit l'échange, et reprend.

_Les touches du clavier :_ la barre d'espace démarre et met en pause le chrono (elle ne rouvre
jamais un combat), D saisit un double, U annule la dernière saisie. Elles ne font rien quand une
fenêtre est ouverte ou qu'on écrit dans un champ.

## Marquer

- Les boutons **Touche propre** et **Contre-frappe** viennent du règlement du tournoi : leurs
  libellés et leurs valeurs sont ceux du règlement.
- En poules et en rondes suisses, **Double** compte pour la limite affichée **Doubles** x/max. À la
  limite, le combat se termine comme le disent les réglages du tournoi : double défaite, nul, ou le
  score reste.
- **Aucun échange** demande la raison : **Sortie de lice**, **Arrêt simultané**,
  **Pas de touche valide** ou une autre.
- Sous chaque combattant : le score, et le score face à la limite de points. À la limite, le score
  passe en or. Tant que des échanges attendent d'être envoyés, la tablette dit combien.
- _Avec le réseau, le combat se termine seul quand une touche atteint la limite de points_ : les
  boutons s'éteignent et le résultat s'affiche. Sans réseau, touchez **Terminer le match** à la
  limite. Terminer avant la limite ou la fin du temps demande d'abord une confirmation.

## Pénalités et réclamations

- Chaque combattant a des boutons rapides pour les pénalités habituelles du tournoi, et une
  recherche pour les autres.
- La tablette affiche le carton que le combattant recevra vraiment : dans un groupe du règlement
  de pénalités, chaque récidive vaut le carton suivant. Un carton jaune est donné tout de suite ; un
  rouge ou un noir demande d'abord (**Donner le carton**). Avec le règlement FFAMHE intégré, le
  rouge coûte un point et le noir fait perdre le combat.
- Le bouton en forme de main enregistre une réclamation, sans question. Quand un combattant
  dépasse la limite de réclamations du tournoi, la tablette propose la pénalité choisie dans les
  paramètres (**Donner le carton**).

![Une recherche de pénalité sur la tablette](../../../assets/guide/13-pad-penalties.png)

## Actions du match

**Actions du match** ouvre les corrections :

- **Inverser les couleurs** et **Inverser les côtés** ;
- **Ajouter du temps** et **Retirer du temps** ;
- choisir un échange, puis **Corriger en aucun échange** pour l'annuler (avec une
  **Raison de correction**) ;
- le forfait : le combattant, la raison, et s'il peut continuer le tournoi, puis
  **Enregistrer le forfait** (pendant que le combat tourne ou est en pause) ;
- **Carton direct** : un carton hors de la liste des pénalités, avec sa raison ;
- **Réinitialiser le match** : efface le combat ; tapez RESET MATCH pour confirmer.

Tout ce qui est dans **Actions du match** demande le réseau, sauf le carton direct.

![Actions du match, ouvert](../../../assets/guide/13-pad-corrections.png)

## Manches, prolongation et mort subite

- Dans un combat en plusieurs manches, l'en-tête affiche la manche, **Terminer le match** devient
  **Terminer la manche**, et un écran de pause propose de lancer la manche suivante.
- Quand les scores sont à égalité à la fin du temps, la tablette propose l'étape suivante que
  définit le tournoi : la prolongation ou la **Mort subite** (le combat se termine alors dès qu'un
  combattant mène). La tablette refuse de terminer un combat à égalité qui doit être départagé.
- Reprendre une fois le temps écoulé demande d'abord : fermer, terminer le combat, ou continuer
  quand même.

## Sans wifi

| La barre dit                                | Ce que ça veut dire                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **EN LIGNE**                                | Tout est envoyé.                                                                                                                  |
| **SYNCHRONISATION**                         | Des saisies sont en cours d'envoi.                                                                                                |
| **HORS LIGNE - échanges en attente locale** | Pas de réseau : continuez, la tablette garde tout.                                                                                |
| **ERREUR DE SYNCHRO**                       | L'envoi a échoué : **Réessayer**.                                                                                                 |
| Touches non enregistrées, **Examiner**      | Le serveur a refusé une saisie : ouvrez **Examiner** pour la renvoyer ou l'abandonner. En attendant, le reste du combat patiente. |

- _En attente sans réseau :_ les touches, les cartons, les réclamations, le chrono (démarrer,
  pause, reprendre, terminer), les manches et la prolongation.
- _Demande le réseau :_ **Rouvrir le match**, **Réinitialiser** le chrono, déverrouiller un
  combat, les forfaits, et tout ce qui est dans **Actions du match** sauf le carton direct.
- Un combat terminé hors ligne indique qu'il a été terminé sur la tablette et que le serveur ne
  l'a pas encore confirmé. Il ne peut pas être rouvert avant le retour du réseau.

![La tablette sans réseau](../../../assets/guide/13-pad-offline.png)

## Verrous et qui peut revenir en arrière

- Une poule ou un tableau terminé se verrouille seul 15 minutes après son dernier combat (réglage
  **Verrouillage auto** du tournoi). Un combat verrouillé affiche un bandeau et refuse le score et
  les corrections.
- Un organisateur (**Éditeur** ou plus) peut toujours rouvrir un combat verrouillé. Un compte de
  tablette ne le peut que si le verrouillage auto du tournoi est désactivé.
- Un compte de tablette ne marque que les lices qui lui sont affectées.

![L'écran de résultat après Terminer le match](../../../assets/guide/13-pad-ended.png)
