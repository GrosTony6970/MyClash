---
title: Indemniser les arbitres
description: 'Comment MyClash calcule ce que gagne chaque arbitre : des points par combat, des paliers en euros, le rapport et ses exports.'
order: 25
section: beyond
---

**Ce que vous allez apprendre :** comment MyClash calcule ce que gagne chaque arbitre, et comment
régler vos propres taux. Les deux onglets sont sur la page **Compensation** de l'événement. Il faut
le rôle **Administrateur**.

## Comment ça marche

1. Un arbitre gagne des points pour chaque combat **terminé** qu'il a arbitré. Les points
   dépendent de son rôle et de la phase : poule, suisse, tableau ou finales.
2. Les paliers du plan transforment le total de points de l'arbitre sur l'événement en un montant
   en euros.
3. Le minimum et le plafond de l'événement ajustent ensuite ce montant. Le minimum l'emporte, même
   au-dessus du plafond.

Les combats qui comptent pour un arbitre :

- affecté à une poule : tous les combats terminés de cette poule ;
- affecté à une lice : tous les combats terminés sur cette lice ;
- affecté à un combat : ce combat.

Dans une phase à élimination, un combat nommé finale, or, bronze ou troisième place compte comme
**finales**. Les montants sont recalculés à chaque ouverture de la page : ils changent pendant que
les combats se terminent.

## Le plan FFAMHE intégré

Points par combat terminé :

| Rôle              | Poule | Suisse | Tableau | Finales |
| ----------------- | ----- | ------ | ------- | ------- |
| Arbitre déclarant | 2     | 3      | 3       | 4       |
| Arbitre assesseur | 1     | 2      | 2       | 3       |
| Arbitre table     | 1     | 1      | 1       | 2       |

Paliers : de 0 à 9 points, 0 € ; de 10 à 19, 10 € ; de 20 à 29, 20 € ; de 30 à 49, 30 € ; à partir
de 50, 50 €.

## Votre propre plan

Ouvrez l'onglet **Plan de compensation**. Les plans intégrés ne se modifient pas : créez le vôtre.

1. Cliquez sur **+ Nouveau plan** et saisissez le **Nom du plan**. Vous pouvez rendre le plan
   visible par les autres organisations.
2. **Taux de jetons (pts/match)** : une ligne par rôle d'arbitre de cet événement, une colonne par
   phase. Les taux vont par demi-points. Cliquez sur **Sauvegarder les taux**.
3. **Paliers jetons vers argent** : **Pts min**, **Pts max** et **Montant (EUR)**. Un maximum vide
   veut dire sans limite. **+ Ajouter une ligne** ajoute un palier. Cliquez sur **Sauvegarder les
   paliers**.

<aside class="guide-warn">
  <p><strong>Difficile à annuler.</strong> Un plan appartient à votre organisation, pas à
  l'événement : chaque événement qui l'utilise paie les nouveaux taux, événements passés compris.</p>
</aside>

- Un nouveau plan part vide : chaque taux et chaque montant vaut 0. Il ne copie pas le plan
  FFAMHE.
- **Un total entre deux paliers paie 0.** Avec des demi-points, 9,5 tombe entre 0–9 et 10–19.
  Faites commencer chaque palier là où finit le précédent.
- Un rôle d'arbitre que vous avez ajouté vous-même gagne 0 tant que vous ne lui donnez pas de taux.
- Un plan qu'un événement utilise encore ne peut pas être supprimé.

## Le rapport

Ouvrez l'onglet **Compensation des arbitres**. Choisissez le **Plan de compensation**, et si vous
le voulez un **Minimum (EUR, facultatif)** et un **Plafond max (EUR, facultatif)**. Enregistrez.

Le tableau montre les points de chaque arbitre par phase, son total, le montant et **Payé**.
Cliquez sur une ligne pour voir le détail par rôle et par phase. La dernière ligne est le **Total
à payer**. **Exporter CSV** et **Exporter PDF** donnent le tableau à votre trésorier.

- **Payé** est une note pour vous : MyClash ne fait aucun paiement.
- Un arbitre sans combat terminé n'est pas dans le tableau.
- Sur un événement archivé, le rapport se lit mais ne se modifie pas.
