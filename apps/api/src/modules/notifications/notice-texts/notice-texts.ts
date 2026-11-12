/**
 * The wording of every automatic notice (operator ruling 202). One owner: a sender reads its data
 * and asks here for the title, the body and the email subject.
 *
 * Every text is French and English side by side, French first, as the other emails are: the API
 * does not know a reader's language. The texts live in the notices namespace of the i18n package.
 * A stand-in for a missing name is a WORD with its own text in each language, never an English
 * word inside a French sentence. A name alone (an organisation, an Event) is said once.
 *
 * Every key is written whole, as one literal: the i18n sweep reads this directory as text, and a
 * key built from parts would hide the whole namespace from its orphan check. For the same reason
 * the key type below names the namespace through a type parameter, not in a template of its own.
 */
import { createTranslator, messages, type KnownTranslationKey } from '@myclash/i18n';

type KeysOf<Namespace extends string> = Extract<KnownTranslationKey, `${Namespace}.${string}`>;
type NoticeKey = KeysOf<'notices'>;
/** A stand-in for a missing name, said in each language. */
interface Word {
  word: NoticeKey;
}

const LANGUAGES = [
  ['fr', createTranslator(messages.fr)],
  ['en', createTranslator(messages.en)],
] as const;

/** A value each language writes its own way: a date. */
export type PerLanguage = Record<(typeof LANGUAGES)[number][0], string>;
type Values = Record<string, string | number | Word | PerLanguage>;

export interface NoticeText {
  title: string;
  body: string;
}
export interface NoticeEmailText extends NoticeText {
  emailSubject: string;
}

/** The name, or its stand-in when the read brought none. */
const or = (name: string | null | undefined, standIn: NoticeKey): string | Word =>
  name || { word: standIn };

function bilingual(key: NoticeKey, values: Values = {}): string {
  return LANGUAGES.map(([language, say]) => {
    const said = Object.entries(values).map(([name, value]) => [
      name,
      typeof value !== 'object' ? value : 'word' in value ? say(value.word) : value[language],
    ]);
    return say(key, Object.fromEntries(said) as Record<string, string | number>);
  }).join(' / ');
}

/** A notice whose email subject is its title. */
const withSubject = (text: NoticeText): NoticeEmailText => ({ ...text, emailSubject: text.title });

export function lockMessage(role: string | null, bout: string | null | undefined): NoticeEmailText {
  const values = { role: or(role, 'notices.lock.yourDuty') };
  return withSubject({
    title: bilingual('notices.lock.title'),
    body: bout
      ? bilingual('notices.lock.bodyForBout', { ...values, bout })
      : bilingual('notices.lock.body', values),
  });
}

/** `when` is the session's start (`sessionWhen`), null when it has none: a Workshop may run twice. */
export function workshopCancelled(
  workshop: string | null,
  when: PerLanguage | null,
): NoticeEmailText {
  const values = { workshop: or(workshop, 'notices.workshopCancelled.yourWorkshop') };
  return withSubject({
    title: bilingual('notices.workshopCancelled.title'),
    body: when
      ? bilingual('notices.workshopCancelled.bodyAt', { ...values, when })
      : bilingual('notices.workshopCancelled.body', values),
  });
}

/**
 * A session moved (to another time or room). `when` is its new start, each language its own way;
 * null when it has none any more. `where` is its room, or null when it names none.
 */
export function workshopMoved(
  workshop: string | null | undefined,
  when: PerLanguage | null,
  where: string | null,
): NoticeEmailText {
  const values = { workshop: or(workshop, 'notices.workshopMoved.yourWorkshop') };
  const body = (): string => {
    if (!when) return bilingual('notices.workshopMoved.bodyNoTime', values);
    if (!where) return bilingual('notices.workshopMoved.bodyNoPlace', { ...values, when });
    return bilingual('notices.workshopMoved.body', { ...values, when, where });
  };
  return withSubject({ title: bilingual('notices.workshopMoved.title'), body: body() });
}

/** `when` as in `workshopCancelled`. */
export function waitlistPromoted(
  workshop: string | null,
  when: PerLanguage | null,
): NoticeEmailText {
  const values = { workshop: or(workshop, 'notices.waitlistPromoted.yourWorkshop') };
  return withSubject({
    title: bilingual('notices.waitlistPromoted.title'),
    body: when
      ? bilingual('notices.waitlistPromoted.bodyAt', { ...values, when })
      : bilingual('notices.waitlistPromoted.body', values),
  });
}

export function resultsPublished(tournament: string): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.resultsPublished.title'),
    body: bilingual('notices.resultsPublished.body', { tournament }),
  });
}

/** The Swiss round message, but for its body: that is one of the three lines below. */
export function swissRound(tournament: string, round: number): Omit<NoticeEmailText, 'body'> {
  return {
    title: bilingual('notices.swissRound.title', { tournament, round }),
    emailSubject: bilingual('notices.swissRound.subject', { tournament, round }),
  };
}

export const swissBye = (round: number): string => bilingual('notices.swissRound.bye', { round });

export const swissPairings = (round: number): string =>
  bilingual('notices.swissRound.pairings', { round });

export function swissFace(
  round: number,
  opponent: string | undefined,
  piste: string | null,
): string {
  const values = { round, opponent: or(opponent, 'notices.swissRound.nextOpponent') };
  return piste
    ? bilingual('notices.swissRound.faceOn', { ...values, piste })
    : bilingual('notices.swissRound.face', values);
}

/** The title is the organisation's name and the body the Event's, with its date and city. */
export function newEvent(
  organiser: string | null | undefined,
  event: string,
  detail: string,
): NoticeEmailText {
  return {
    title: organiser || bilingual('notices.newEvent.anOrganiser'),
    body: detail ? `${event} — ${detail}` : event,
    emailSubject: bilingual('notices.newEvent.subject', {
      organiser: or(organiser, 'notices.newEvent.anOrganiser'),
      event,
    }),
  };
}

export function matchStarting(bout: string | null): NoticeText {
  return {
    title: bilingual('notices.matchStarting.title'),
    body: bilingual('notices.matchStarting.body', {
      bout: or(bout, 'notices.matchStarting.yourMatch'),
    }),
  };
}

export function workshopStarting(workshop: string | null | undefined): NoticeText {
  return {
    title: bilingual('notices.workshopStarting.title'),
    body: bilingual('notices.workshopStarting.body', {
      workshop: or(workshop, 'notices.workshopStarting.yourWorkshop'),
    }),
  };
}

export function refereeStarting(role: string | null, bout: string | null | undefined): NoticeText {
  const values = { role: or(role, 'notices.refereeStarting.yourDuty') };
  return {
    title: bilingual('notices.refereeStarting.title'),
    body: bout
      ? bilingual('notices.refereeStarting.bodyForBout', { ...values, bout })
      : bilingual('notices.refereeStarting.body', values),
  };
}

export function followMatch(bout: {
  fighter: string;
  opponent: string;
  minutes: number;
  label: string | null | undefined;
  piste: string | null | undefined;
}): NoticeText {
  return {
    title: bilingual('notices.followMatch.title'),
    body: bilingual('notices.followMatch.body', {
      fighter: or(bout.fighter, 'notices.followMatch.aFighter'),
      opponent: or(bout.opponent, 'notices.followMatch.anOpponent'),
      minutes: bout.minutes,
      bout: or(bout.label, 'notices.followMatch.aMatch'),
      piste: or(bout.piste, 'notices.followMatch.theirPiste'),
    }),
  };
}

export function followReferee(
  referee: string,
  minutes: number,
  bout: string | null | undefined,
  piste: string | null | undefined,
): NoticeText {
  const values = { referee: or(referee, 'notices.followReferee.aReferee'), minutes };
  const body = (): string => {
    if (bout && piste) {
      return bilingual('notices.followReferee.bodyBoutPiste', { ...values, bout, piste });
    }
    if (bout) return bilingual('notices.followReferee.bodyBout', { ...values, bout });
    if (piste) return bilingual('notices.followReferee.bodyPiste', { ...values, piste });
    return bilingual('notices.followReferee.body', values);
  };
  return { title: bilingual('notices.followReferee.title'), body: body() };
}

export function followWorkshop(
  workshop: string | null | undefined,
  instructor: string | undefined,
  minutes: number,
): NoticeText {
  return {
    title: bilingual('notices.followWorkshop.title'),
    body: bilingual('notices.followWorkshop.body', {
      workshop: or(workshop, 'notices.followWorkshop.aWorkshop'),
      instructor: or(instructor, 'notices.followWorkshop.anInstructor'),
      minutes,
    }),
  };
}

/** The body of this notice is the organiser's own reason: it is not translated. */
export const correctionRejectedTitle = (): string => bilingual('notices.correctionRejected.title');

/** The reason a request ends with when somebody edited the hit it asked to void (ruling 254). */
export const correctionHitChanged = (): string =>
  bilingual('notices.correctionRejected.hitChanged');

/** The reason a request ends with when its bout was put back on the schedule (rulings 257, 274). */
export const correctionBoutReset = (): string => bilingual('notices.correctionRejected.boutReset');

/**
 * The reason saved on a request for review that came with none: a restore never
 * carries one. Not a notice, but its reviewer may read either language (ruling 258).
 */
export const correctionWithNoReason = (): string => bilingual('notices.correctionRequest.noReason');

export function correctionApproved(): NoticeText {
  return {
    title: bilingual('notices.correctionApproved.title'),
    body: bilingual('notices.correctionApproved.body'),
  };
}

/** FightBook: a new spar request. No name: it shows on a locked phone. */
export function sparRequestReceived(): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.sparRequestReceived.title'),
    body: bilingual('notices.sparRequestReceived.body'),
  });
}

/** FightBook: the fighter asked said yes. No name. */
export function sparAgreed(): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.sparAgreed.title'),
    body: bilingual('notices.sparAgreed.body'),
  });
}

/** FightBook: the other fighter cancelled an agreed spar. No name, no message. */
export function sparCancelled(): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.sparCancelled.title'),
    body: bilingual('notices.sparCancelled.body'),
  });
}

/** FightBook: a safety flag was raised. To the club's admins or the super admins. No name, no reason. */
export function sparFlagRaised(): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.sparFlagRaised.title'),
    body: bilingual('notices.sparFlagRaised.body'),
  });
}

/** FightBook: the other fighter marked an agreed spar as done. No name. */
export function sparMarkedDone(): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.sparMarkedDone.title'),
    body: bilingual('notices.sparMarkedDone.body'),
  });
}
