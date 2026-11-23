---
title: À propos de MyClash
description: "Qui construit MyClash, comment l'IA est utilisée, et pourquoi c'est gratuit."
order: -1
section: about
---

MyClash a été lancé par Anthony Garnier. Je suis architecte cloud : la virtualisation, le cloud
public, les conteneurs, le réseau, le stockage et les systèmes sont mon quotidien. Écrire le code
d'une application, non.

Tout a commencé avec MyFAL, une application que j'ai « vibe-codée » pour le tournoi de la Fosse aux
Lions 2026 à Lyon. Elle n'était pas parfaite, mais les retours ont été bons, et on m'a demandé
comment la faire fonctionner pour d'autres tournois. MyClash est la réponse : une seule plateforme
qui s'adapte à la façon de travailler de chaque organisateur et de chaque club, sans modifier le
code pour chacun.

## L'IA, un outil

La plus grande partie du code est écrite par l'IA, surtout Claude d'Anthropic, sous ma direction.
Je décide de ce qui est construit, je le teste, et je le fais tourner sur mon propre serveur. En six
mois environ, c'est devenu une plateforme stable et riche en fonctionnalités, que je n'aurais pas pu
construire seul sur mon temps libre.

Je vois l'IA comme un outil. Ce qui compte, c'est la façon de s'en servir. Ici, cela veut dire :

- Chaque agent travaille sous un
  [contrat écrit](https://github.com/GrosTony6970/MyClash/blob/main/CLAUDE.md) : des règles
  strictes sur le score, l'usage hors ligne, l'accès aux données et la sécurité de l'arbitrage.
- Chaque changement est testé, et doit passer toute la chaîne de contrôles avant d'être intégré.
- Le moteur de score doit reproduire à l'identique les résultats officiels de la Fosse aux Lions 2026.
- Une correction vise la cause du problème, pas son contournement.

Pour moi, l'IA est un accélérateur et une opportunité. Elle permet à une seule personne de
transformer une idée et une vision en un vrai produit, sans maîtriser en profondeur chaque couche.
J'essaie de faire entrer l'AMHE dans le XXIe siècle avec les outils d'aujourd'hui.

## Pas tout seul

Des clubs d'AMHE de la région lyonnaise aident pour les tests bêta et proposent de nouvelles
fonctionnalités.

## Gratuit et ouvert

MyClash est gratuit et open source (licence AGPL-3.0). Je le construis sur mon temps libre, et je
paie moi-même l'abonnement à l'IA et le serveur. Aucune entreprise n'est derrière.

## Sans garantie de service

Il n'y a pas d'engagement de niveau de service (SLA). Chaque organisateur est responsable de son
événement et de ce qu'il fait avec la plateforme. Nous faisons tout de même de notre mieux pour que
MyClash reste en ligne et disponible : un agent d'exploitation automatique vérifie le serveur chaque
jour, et les alertes (erreurs, supervision) m'arrivent par e-mail et sur mon téléphone. Les
[conditions d'utilisation](/terms) font foi.
