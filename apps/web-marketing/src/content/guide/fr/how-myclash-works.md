---
title: Comment fonctionne MyClash
description: 'Les mots de MyClash, ses trois applications, qui voit quoi, et comment un score est compté.'
order: 11
section: concepts
---

**Ce que vous allez apprendre :** les mots qu'utilise MyClash, comment lire le code d'un combat,
ses trois applications, qui voit quoi, et d'où vient un score.

## Les mots

- **Événement** : le rassemblement, avec ses dates, son lieu et ses lices. Une soirée club est un
  événement ; un open de trois jours aussi.
- **Tournoi** : une compétition à l'intérieur de l'événement : une arme, une catégorie, un
  règlement. Un événement peut en contenir plusieurs.
- **Atelier** : un cours à l'intérieur de l'événement, avec ses séances et ses inscriptions.
- **Phase** : une étape d'un tournoi avec un format : des poules, un tableau (élimination directe
  ou double élimination) ou des rondes suisses.
- **Poule** : un groupe où chaque combattant rencontre tous les autres.
- **Match** (un combat à l'écran) : deux combattants, un rouge et un bleu.
- **Échange** : une action que le marqueur saisit : une touche propre, une contre-frappe, une
  double touche, ou aucun échange. Tout le reste est calculé à partir des échanges.
- **Lice** : la piste où se déroule un combat.
- **Lieu** : un endroit enregistré, avec ses lices, que les nouveaux événements peuvent reprendre.

Un combattant a un **profil** MyClash qui le suit d'un événement à l'autre. À votre événement, il
est **participant** ; dans un tournoi, il a une **inscription**.

## Les codes des combats

Chaque combat a un code court qui le nomme partout de la même façon : sur la tablette, le
planning, les écrans en direct, les notifications et les exports. Il se lit en trois parties :
l'arme, l'étape, puis le combat.

| Code          | Se lit                                                  |
| ------------- | ------------------------------------------------------- |
| `LSW-P4-M01`  | Épée longue, poule 4, combat 1 de cette poule           |
| `SDW-S3-M05`  | Épée de côté, ronde suisse 3, combat 5 de cette ronde   |
| `LSW-B-QF-M3` | Épée longue, tableau, quart de finale, combat 3 du tour |
| `LSW-B-F-M1`  | Épée longue, tableau, la finale                         |
| `LSW-B-F-M2`  | Épée longue, tableau, le match pour la troisième place  |

- **L'arme**, d'après son nom anglais : LSW épée longue (longsword), SDW épée de côté
  (sidesword), RAP rapière, SBR sabre, SB épée et bocle (sword and buckler). Toute autre arme
  prend les trois premières lettres de son nom : un tournoi de dussack se lit DUS.
- **L'étape** : P et le numéro de la poule, S et la ronde suisse, ou B pour tout combat de
  tableau, suivi de son tour :
  - R64, R32, R16 (les tours de 64, 32 et 16), QF les quarts de finale, SF les demi-finales,
    F la finale, PI le tour préliminaire ;
  - un tableau à double élimination nomme aussi son côté : WBQF, WBSF, WBF pour les quarts, les
    demies et la finale du tableau principal, LB1, LB2… pour les tours des repêchages, GF la
    grande finale et GFR sa revanche (le reset) ;
  - B sans tour désigne un combat ajouté à la main dans un tableau.
- **Le combat** : M et son numéro. Dans une poule ou une ronde suisse, c'est l'ordre de passage,
  écrit avec autant de chiffres que la poule en demande : M02 passe avant M10. Dans un tableau,
  c'est sa place dans le tour, comptée depuis le haut. Au dernier tour, M1 est la finale et M2 le
  match pour la troisième place.

## Trois applications

| Application            | Adresse          | Pour qui                                                                    |
| ---------------------- | ---------------- | --------------------------------------------------------------------------- |
| L'espace organisateur  | admin.myclash.fr | Vous et les membres de votre club                                           |
| Les tablettes          | staff.myclash.fr | Les marqueurs, l'accueil, le contrôle du matériel, la modération des photos |
| L'application publique | app.myclash.fr   | Les combattants, les arbitres et le public                                  |

Dans l'application publique, chacun voit les pages de l'événement : les combats en direct, le
planning, les poules, les tableaux et les résultats. Un combattant qui a un compte a aussi un
espace personnel : ses combats, les ateliers qu'il a rejoints, les personnes et les clubs qu'il
suit.

## Qui voit quoi

- Un événement en **brouillon** et un événement de **test** sont cachés au public. Les membres de
  votre club les voient toujours.
- Un tournoi n'est public que s'il est **publié**, en cours ou terminé, et que son événement est
  public aussi.
- Les membres de votre club voient tout, brouillons compris, selon leur rôle (voir la page
  « Les accès » de cette section).

## D'où vient un score

Le marqueur ne saisit jamais un score. Il saisit des **échanges**, et MyClash calcule le score à
partir d'eux avec le **règlement** du tournoi. La tablette affiche le score tout de suite ; le
serveur le recalcule à partir des mêmes échanges, et c'est son résultat qui compte.

Une correction ne supprime jamais rien : elle annule un échange, et le score est recalculé.

_Sans wifi_, la tablette garde chaque échange dans une file d'attente et l'envoie quand le
réseau revient. Chaque échange porte sa propre identité : envoyé deux fois, il ne compte qu'une
fois. La page « Référence de la tablette », dans la section tablette de score, dit ce qui marche
hors ligne et ce qui ne marche pas.
