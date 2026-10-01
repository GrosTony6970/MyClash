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
type Values = Record<string, string | number | Word>;

export interface NoticeText {
  title: string;
  body: string;
}
export interface NoticeEmailText extends NoticeText {
  emailSubject: string;
}

const LANGUAGES = [createTranslator(messages.fr), createTranslator(messages.en)];

/** The name, or its stand-in when the read brought none. */
const or = (name: string | null | undefined, standIn: NoticeKey): string | Word =>
  name || { word: standIn };

function bilingual(key: NoticeKey, values: Values = {}): string {
  return LANGUAGES.map((say) => {
    const said = Object.entries(values).map(([name, value]) => [
      name,
      typeof value === 'object' ? say(value.word) : value,
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

export function workshopCancelled(workshop: string | null): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.workshopCancelled.title'),
    body: bilingual('notices.workshopCancelled.body', {
      workshop: or(workshop, 'notices.workshopCancelled.yourWorkshop'),
    }),
  });
}

export function waitlistPromoted(workshop: string | null): NoticeEmailText {
  return withSubject({
    title: bilingual('notices.waitlistPromoted.title'),
    body: bilingual('notices.waitlistPromoted.body', {
      workshop: or(workshop, 'notices.waitlistPromoted.yourWorkshop'),
    }),
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
