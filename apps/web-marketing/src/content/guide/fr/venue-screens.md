---
title: Les écrans dans la salle
description: 'Les écrans à mettre sur une télé ou un projecteur dans la salle, comment les ouvrir, et ce que chacun affiche.'
order: 20
section: day
---

**Ce que vous allez apprendre :** quel écran mettre où, où trouver son adresse, et quoi vérifier
avant le jour J. Chaque écran est une page web : ouvrez-la dans le navigateur de l'ordinateur ou
de la télé qui pilote l'écran.

## L'écran de lice : un par lice

L'écran principal, pour le public et les combattants. Il affiche le combat de cette lice : les
deux combattants avec leur club, le score en grand, les cartons, le chrono, les échanges, et le
combat suivant. Quand un combat se termine, il passe seul au combat suivant de la lice après
quelques secondes. Quand il ne reste rien sur la lice, il affiche **En attente du prochain
assaut...**.

- **Adresse :** `app.myclash.fr/e/<votre événement>/lice/<lice>/display`. Elle est publique.
- **Où la trouver :** ouvrez **Staff événement**. Sur un compte tablette qui a des lices, **URLs
  affichage externe** liste **Affichage pour** chaque lice, avec **Copier URL**. Ou ouvrez **En
  direct**, dépliez la ligne d'une lice, et cliquez sur **Écran piste ↗**.
- **Ses commandes** apparaissent quand vous bougez la souris ou touchez l'écran, et se cachent
  après quelques secondes : **Changer de lice**, **⇄ Inverser les côtés** (met rouge et bleu dans
  l'autre sens, pour un écran qui regarde la lice depuis l'autre côté), **Plein écran**, et **Tous
  les affichages**.
- Il se met à jour en direct. Si la connexion tombe, il garde la dernière image et affiche **Plus
  de mise à jour** (ou **Mises à jour ralenties**) jusqu'à ce qu'il rattrape son retard.

## La liste des écrans

`app.myclash.fr/e/<votre événement>/display` ouvre **Affichages** : les combats **En direct**, et
**Choisir une lice** avec **Ouvrir l'affichage** pour chaque lice. Ouvrez-la sur l'ordinateur à
côté de la télé et choisissez la lice là. Son adresse est sur **Staff événement**, dans le panneau
**Connexion staff** : **Tous les affichages (choix de lice)**, avec **Copier URL**.

## Un combat sur un second écran, depuis la tablette

Quand vous ouvrez la tablette de score depuis votre espace (cliquez sur un combat dans
**Poules**, **Tableau** ou **Planning**), elle affiche **↗ Affichage externe**. Ce bouton ouvre
le tableau de score du combat dans une nouvelle fenêtre : faites-la glisser sur le second écran et
cliquez sur **Plein écran**. Ici, **⇄ Inverser les côtés** est actif par défaut, pour un écran
tourné vers le public. La fenêtre suit la tablette au combat suivant.

Un marqueur connecté avec un PIN n'a pas ce bouton : utilisez l'écran de lice. Dans **En
direct**, la ligne d'une lice a aussi **TV ↗**, qui ouvre le même tableau de score.

## Le mur : toutes les lices d'un coup

Pour votre propre table : une ligne par lice, celles qui ont besoin de vous d'abord, avec le
score, l'état du combat, le chrono et le retard de la lice. Il se rafraîchit toutes les quelques
secondes.

- **Adresse :** `admin.myclash.fr/display/wall/<numéro de l'événement>`. Le numéro de
  l'événement est le long code après `/events/` dans l'adresse de votre espace. Aucun bouton ne
  mène à cet écran : tapez l'adresse.
- Il faut être connecté à votre espace avec le rôle **Teneur de score** ou plus.

## Pour les téléphones : la page En direct

`app.myclash.fr/e/<votre événement>/live` affiche chaque lice, son combat et le suivant. Elle est
faite pour les téléphones des spectateurs, pas pour une télé. Pendant l'événement, sa page
affiche un bouton **En direct** qui y mène.

## Avant le jour J

- **Un événement de test ou un brouillon est caché.** Ses écrans publics affichent une page introuvable,
  sauf si le navigateur est connecté à MyClash avec un compte de votre organisation : connectez-vous
  d'abord sur `app.myclash.fr`.
- **Un écran affiche ce que le serveur sait.** Une tablette qui marque sans réseau envoie ses
  touches au retour du réseau ; l'écran les affiche à ce moment-là.
- **Essayez chaque écran sur la vraie télé,** avec le réseau de la salle, avant le premier combat.
  Donnez aux écrans une connexion fiable : quand elle tombe, l'image se fige.
