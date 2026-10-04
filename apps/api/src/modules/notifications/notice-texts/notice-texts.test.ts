/**
 * Every automatic notice is written in French and in English, side by side (ruling 202). Paul
 * reads MyClash in French, and his phone said "Results published": the API does not know a
 * reader's language, so it now says both, French first, as the other emails do. Each text below is
 * written out whole: a key that resolves to nothing would print itself in brackets and fail here.
 */
import { describe, expect, it } from 'vitest';
import * as texts from './notice-texts';

describe('the notices of the Tournament day', () => {
  it('the lock message names the duty and its bout', () => {
    const title = "Affectation d'arbitrage mise à jour / Referee assignment updated";
    expect(texts.lockMessage('arbitre_table', 'L1-P1-M1')).toEqual({
      title,
      body: 'Mise à jour : arbitre_table, L1-P1-M1. / arbitre_table for L1-P1-M1 has been updated.',
      emailSubject: title,
    });
    expect(texts.lockMessage('arbitre_table', null).body).toBe(
      'Mise à jour : arbitre_table. / arbitre_table has been updated.',
    );
  });

  it('a duty with no role is "your referee assignment", in each language', () => {
    expect(texts.lockMessage(null, null).body).toBe(
      "Mise à jour : votre affectation d'arbitrage. / Your referee assignment has been updated.",
    );
    expect(texts.refereeStarting(null, 'L1-P1-M1').body).toBe(
      "Bientôt : votre affectation d'arbitrage, L1-P1-M1. / Your referee assignment starts soon for L1-P1-M1.",
    );
  });

  it('the results notice', () => {
    const title = 'Résultats publiés / Results published';
    expect(texts.resultsPublished('Longsword')).toEqual({
      title,
      body: 'Longsword : les résultats sont publiés. / Longsword results are now published.',
      emailSubject: title,
    });
  });

  it('the Swiss round message, and its three lines', () => {
    expect(texts.swissRound('Longsword', 3)).toEqual({
      title: 'Longsword — ronde 3 / Longsword — round 3',
      emailSubject: 'Longsword : appariements de la ronde 3 / Longsword: round 3 pairings',
    });
    expect(texts.swissBye(3)).toBe(
      "Ronde 3 : vous n'avez pas d'adversaire (exemption). / You have a bye in round 3.",
    );
    expect(texts.swissPairings(3)).toBe(
      'Les appariements de la ronde 3 sont publiés. / Round 3 pairings are published.',
    );
    expect(texts.swissFace(3, 'Paul Petit', 'Piste 2')).toBe(
      'Ronde 3 : vous affrontez Paul Petit sur Piste 2. / Round 3: you face Paul Petit on Piste 2.',
    );
    expect(texts.swissFace(3, 'Paul Petit', null)).toBe(
      'Ronde 3 : vous affrontez Paul Petit. / Round 3: you face Paul Petit.',
    );
    expect(texts.swissFace(3, undefined, null)).toBe(
      'Ronde 3 : vous affrontez votre prochain adversaire. / Round 3: you face your next opponent.',
    );
  });

  it('the "starting soon" alerts of a Fighter and of a referee', () => {
    expect(texts.matchStarting('L1-P1-M1')).toEqual({
      title: 'Combat imminent / Match starting soon',
      body: 'L1-P1-M1 commence bientôt. / L1-P1-M1 starts soon.',
    });
    expect(texts.matchStarting(null).body).toBe(
      'Votre combat commence bientôt. / Your match starts soon.',
    );
    expect(texts.refereeStarting('arbitre_table', 'L1-P1-M1')).toEqual({
      title: 'Arbitrage imminent / Referee slot starting soon',
      body: 'Bientôt : arbitre_table, L1-P1-M1. / arbitre_table starts soon for L1-P1-M1.',
    });
    expect(texts.refereeStarting('arbitre_table', null).body).toBe(
      'Bientôt : arbitre_table. / arbitre_table starts soon.',
    );
  });

  it('the title of a refused correction: its body is the organiser’s own reason', () => {
    expect(texts.correctionRejectedTitle()).toBe(
      'Demande de correction refusée / Exchange correction rejected',
    );
  });

  it('an approved correction, and the reason a request ends with when its hit was edited', () => {
    expect(texts.correctionApproved()).toEqual({
      title: 'Demande de correction approuvée / Exchange correction approved',
      body: 'La correction demandée a été faite. / The correction you asked for was made.',
    });
    expect(texts.correctionHitChanged()).toBe(
      'Un administrateur a modifié cet échange. Refaites une demande si le nouvel échange est faux lui aussi. / An administrator changed this exchange. Ask again if the new exchange is wrong too.',
    );
  });
});

describe('the notices of a Workshop', () => {
  it('a cancelled Workshop and a place off the waitlist', () => {
    const cancelled = 'Atelier annulé / Workshop cancelled';
    expect(texts.workshopCancelled('Messer')).toEqual({
      title: cancelled,
      body: 'Annulé : Messer. / Messer was cancelled.',
      emailSubject: cancelled,
    });
    const confirmed = 'Place en atelier confirmée / Workshop place confirmed';
    expect(texts.waitlistPromoted('Messer')).toEqual({
      title: confirmed,
      body: "Vous quittez la liste d'attente : votre place est confirmée pour Messer. / You have been promoted from the waitlist for Messer.",
      emailSubject: confirmed,
    });
  });

  it('a Workshop whose title could not be read is "your workshop", in each language', () => {
    expect(texts.workshopCancelled(null).body).toBe(
      'Annulé : votre atelier. / Your workshop was cancelled.',
    );
    expect(texts.waitlistPromoted(null).body).toBe(
      "Vous quittez la liste d'attente : votre place est confirmée pour votre atelier. / You have been promoted from the waitlist for Your workshop.",
    );
    expect(texts.workshopStarting(null).body).toBe(
      'Votre atelier commence bientôt. / Your workshop starts soon.',
    );
  });

  it('the "starting soon" alert', () => {
    expect(texts.workshopStarting('Messer')).toEqual({
      title: 'Atelier imminent / Workshop starting soon',
      body: 'Messer commence bientôt. / Messer starts soon.',
    });
  });
});

describe('the notices about the people and organisations a reader follows', () => {
  it('a new Event keeps the names as they are, said once', () => {
    expect(texts.newEvent('Lyon HEMA', 'Open de Lyon', '2026-10-03 · Lyon')).toEqual({
      title: 'Lyon HEMA',
      body: 'Open de Lyon — 2026-10-03 · Lyon',
      emailSubject: 'Lyon HEMA a publié Open de Lyon / Lyon HEMA published Open de Lyon',
    });
    expect(texts.newEvent('Lyon HEMA', 'Open de Lyon', '').body).toBe('Open de Lyon');
  });

  it('an organisation that could not be read is "an organiser", in each language', () => {
    expect(texts.newEvent(null, 'Open de Lyon', '')).toMatchObject({
      title: 'Un organisateur / An organiser',
      emailSubject: 'Un organisateur a publié Open de Lyon / An organiser published Open de Lyon',
    });
  });

  it('a followed Fighter', () => {
    const bout = { fighter: 'Léa Martin', opponent: 'Paul Petit', minutes: 10 };
    expect(texts.followMatch({ ...bout, label: 'Pool A', piste: 'Piste 2' })).toEqual({
      title: 'Un combattant suivi combat bientôt / Followed fighter starting soon',
      body: 'Léa Martin combat dans 10 min - Pool A contre Paul Petit sur Piste 2. / Léa Martin fights in 10 min - Pool A vs Paul Petit on Piste 2.',
    });
    expect(texts.followMatch({ ...bout, fighter: '', label: null, piste: null }).body).toBe(
      'Un combattant suivi combat dans 10 min - Combat contre Paul Petit sur sa piste. / A followed fighter fights in 10 min - Match vs Paul Petit on their lice.',
    );
    expect(
      texts.followMatch({ ...bout, opponent: '', label: 'Pool A', piste: 'Piste 2' }).body,
    ).toBe(
      'Léa Martin combat dans 10 min - Pool A contre un adversaire sur Piste 2. / Léa Martin fights in 10 min - Pool A vs an opponent on Piste 2.',
    );
  });

  it('a followed referee, with or without the bout and the piste', () => {
    const title = 'Un arbitre suivi officie bientôt / Followed referee starting soon';
    expect(texts.followReferee('Marc Roux', 10, 'L1-P1-M1', 'Piste 2')).toEqual({
      title,
      body: 'Marc Roux officie dans 10 min - L1-P1-M1 sur Piste 2. / Marc Roux referees in 10 min - L1-P1-M1 on Piste 2.',
    });
    expect(texts.followReferee('Marc Roux', 10, 'L1-P1-M1', null).body).toBe(
      'Marc Roux officie dans 10 min - L1-P1-M1. / Marc Roux referees in 10 min - L1-P1-M1.',
    );
    expect(texts.followReferee('Marc Roux', 10, null, 'Piste 2').body).toBe(
      'Marc Roux officie dans 10 min sur Piste 2. / Marc Roux referees in 10 min on Piste 2.',
    );
    expect(texts.followReferee('', 10, null, null).body).toBe(
      'Un arbitre suivi officie dans 10 min. / A followed referee referees in 10 min.',
    );
  });

  it('a followed instructor', () => {
    expect(texts.followWorkshop('Messer', 'Anna Weber', 15)).toEqual({
      title:
        "L'atelier d'un instructeur suivi commence bientôt / Followed instructor workshop soon",
      body: 'Messer avec Anna Weber commence dans 15 min. / Messer with Anna Weber starts in 15 min.',
    });
    expect(texts.followWorkshop(null, undefined, 15).body).toBe(
      'Un atelier avec un instructeur suivi commence dans 15 min. / A workshop with A followed instructor starts in 15 min.',
    );
  });
});
