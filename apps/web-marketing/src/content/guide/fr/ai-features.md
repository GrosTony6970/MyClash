---
title: Les fonctions IA
description: "Votre propre clé IA, les quatre outils qu'elle ouvre, ce qu'ils envoient au fournisseur d'IA, et les limites."
order: 26
section: beyond
---

**Ce que vous allez apprendre :** activer les fonctions IA pour votre organisation, ce que fait
chaque outil, et ce qu'il envoie au fournisseur d'IA. Il faut le rôle **Administrateur** pour
tout cela.

## L'activer

MyClash ne paie pas votre IA : votre organisation ajoute sa propre clé.

1. Ouvrez **Paramètres IA** dans le menu de votre organisation.
2. Ajoutez une clé d'Anthropic, d'OpenAI, de Mistral ou de Google.
3. Laissez **Activer les fonctionnalités IA pour cette organisation** et **Activer le chatbot
   organisateur** activés. Désactivez-les pour arrêter l'IA sans retirer la clé.

Sans clé, chaque outil IA le dit et ne fait rien.

## Les quatre outils

| Outil                          | Où                                                                                           | Ce qu'il fait                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assistant IA**               | Le menu de l'événement ; **Suggestion IA** sur les pages Poules, Tableau et Planning l'ouvre | Prépare un brouillon : les réglages d'un tournoi, un plan de poules, un plan de tableau, une grille de planning ou des affectations d'arbitres |
| **Chatbot**                    | Le menu de l'événement                                                                       | Répond aux questions sur votre événement et propose des changements                                                                            |
| **Récap de tournoi**           | Les réglages du tournoi                                                                      | Écrit un court récap des résultats, en anglais ou en français, pour la page publique                                                           |
| **Description de l'événement** | **Rédiger avec l'IA** dans le formulaire de l'événement                                      | Écrit le champ description. Rien n'est enregistré avant que vous enregistriez le formulaire                                                    |

## Rien ne change sans vous

- **Assistant IA :** décrivez ce que vous voulez dans la **Consigne organisateur**, choisissez le
  **Type de brouillon** et cliquez sur **Créer le brouillon**. Lisez l'**Aperçu du brouillon**,
  puis **Appliquer** ou **Rejeter**.
- **Chatbot :** chaque changement qu'il propose s'affiche dans une carte. **Confirmer et
  appliquer** fait le changement ; **Ignorer** l'écarte.
- Aucun des deux ne supprime un combat déjà disputé.
- Les affectations d'arbitres passent par les mêmes contrôles que les vôtres : une affectation
  refusée reste refusée.
- Aucun des deux ne modifie un événement terminé.
- **Récap :** **Générer le récap**, lisez-le, puis **Publier**. **Régénérer** écrit un nouveau
  brouillon ; le récap publié reste sur la page publique tant que vous ne publiez pas le nouveau.
  **Dépublier** le retire.

## Ce que reçoit le fournisseur d'IA

| Outil                      | Ce qui est envoyé                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant IA               | Le nom de l'événement, le tournoi et votre consigne. Il ne voit ni poule, ni combat, ni personne : un brouillon de poules, de planning ou d'arbitres peut donc échouer |
| Chatbot                    | Vos messages, et ce qu'il lit pour répondre : tournois, poules, lices, combats à programmer, comptes, et les noms des arbitres affectés                                |
| Récap de tournoi           | Les résultats, avec les noms et les clubs du podium                                                                                                                    |
| Description de l'événement | Le nom, la ville et les dates de l'événement, et les noms de ses tournois et ateliers                                                                                  |

Les conversations du chatbot sont partagées : chaque administrateur de votre organisation peut les
lire.

## Les limites

- **Budget mensuel** (dans **Paramètres IA**) : ce que votre organisation dépense en un mois.
- **Plafond de dépense (EUR)** (sous **Budget IA** dans la vue d'ensemble de l'événement) : ce que
  dépense un événement.
- L'équipe MyClash peut couper l'IA pour tout le monde, et a sa propre limite mensuelle.

Les limites sont vérifiées avant chaque appel : un appel peut donc les dépasser un peu.
