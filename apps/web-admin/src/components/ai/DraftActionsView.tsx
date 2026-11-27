'use client';

import type {
  ReadableDraftAction,
  ReadableMatch,
  ReadableMissing,
  ReadableName,
  ReadablePhase,
  ReadablePool,
} from '@myclash/types';
import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { formatInZone, localeToBcp47 } from '@myclash/time';

/**
 * A draft's actions in words, one line each (ruling 993): the assistant page and the chat's
 * proposal card both show a draft through this view (ruling 995). The names come from the API
 * (`readable`, call U); the words are here, in EN and FR. A row the Event no longer has reads
 * as "a bout removed since", never as its id. A start shows on the Event's wall clock: each
 * placement carries the Event's zone.
 */
export function DraftActionsView({ actions }: { actions: ReadableDraftAction[] }) {
  const { t, locale } = useI18n();
  if (actions.length === 0) {
    return <p className="text-sm text-muted">{t('organizer.aiAssistant.readable.none')}</p>;
  }
  const bcp47 = localeToBcp47(locale);
  return (
    <ul className="space-y-1 text-sm text-foreground">
      {actions.map((action, index) => (
        <li key={index}>{actionLine(action, t, bcp47)}</li>
      ))}
    </ul>
  );
}

/** The action's main sentence, then its details after a dash. */
function actionLine(action: ReadableDraftAction, t: Translator, bcp47: string): string {
  const [main, ...details] = actionParts(action, t, bcp47);
  return details.length > 0 ? `${main} — ${details.join(', ')}` : main!;
}

const isMissing = (value: object): value is ReadableMissing => 'missing' in value;

/** When a Match starts: the day and the time, on the Event's clock. */
const START: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

function actionParts(action: ReadableDraftAction, t: Translator, bcp47: string): string[] {
  switch (action.kind) {
    case 'create_tournament':
      return [
        action.name
          ? t('organizer.aiAssistant.readable.createTournament', { name: action.name })
          : t('organizer.aiAssistant.readable.createTournamentNoName'),
        ...(action.slug ? [t('organizer.aiAssistant.readable.slug', { slug: action.slug })] : []),
        ...(action.weapon
          ? [t('organizer.aiAssistant.readable.weapon', { weapon: action.weapon })]
          : []),
        ...(action.rulesetCode
          ? [t('organizer.aiAssistant.readable.ruleset', { ruleset: action.rulesetCode })]
          : []),
      ];
    case 'generate_pools':
      return [
        poolsSentence(action, t),
        ...(action.schoolSeparation ? [t('organizer.aiAssistant.readable.clubsApart')] : []),
        ...(action.skillBalance ? [t('organizer.aiAssistant.readable.skillBalanced')] : []),
        ...(action.seed !== undefined
          ? [t('organizer.aiAssistant.readable.seed', { seed: action.seed })]
          : []),
        ...(action.force ? [t('organizer.aiAssistant.readable.replacesPools')] : []),
      ];
    case 'generate_bracket':
      return [
        t('organizer.aiAssistant.readable.bracket', {
          tournament: tournamentName(action.tournament, t),
        }),
        ...(action.phaseType ? [phaseTypeWord(action.phaseType, t)] : []),
        ...(action.qualifyCount !== undefined
          ? [t('organizer.aiAssistant.readable.qualify', { count: action.qualifyCount })]
          : []),
        ...(action.bracketSize !== undefined
          ? [t('organizer.aiAssistant.readable.bracketSize', { size: action.bracketSize })]
          : []),
        ...(action.poolPhase ? [seededFrom(action.poolPhase, t)] : []),
        ...(action.force ? [t('organizer.aiAssistant.readable.replacesBracket')] : []),
      ];
    case 'schedule_match':
      return [scheduleSentence(action, t, bcp47)];
    case 'assign_referee':
      return [assignSentence(action, t)];
    case 'unsupported':
      return [t('organizer.aiAssistant.readable.unsupported')];
  }
}

function tournamentName(value: ReadableName, t: Translator): string {
  return isMissing(value) ? t('organizer.aiAssistant.readable.missing.tournament') : value.name;
}

function matchName(value: ReadableMatch | ReadableMissing, t: Translator): string {
  if (isMissing(value)) return t('organizer.aiAssistant.readable.missing.match');
  return t('organizer.aiAssistant.readable.match', {
    code: value.code,
    tournament: value.tournament,
  });
}

function poolName(value: ReadablePool | ReadableMissing, t: Translator): string {
  if (isMissing(value)) return t('organizer.aiAssistant.readable.missing.pool');
  return t('organizer.aiAssistant.readable.pool', {
    number: value.number,
    tournament: value.tournament,
  });
}

/** A phase's type in words: `pool`, `swiss`, `single_elim`, `double_elim` (`phase_type_check`). */
function phaseTypeWord(type: string, t: Translator): string {
  return t(`organizer.aiAssistant.readable.phaseTypes.${type}`);
}

function seededFrom(value: ReadablePhase | ReadableMissing, t: Translator): string {
  if (isMissing(value)) return t('organizer.aiAssistant.readable.missing.phase');
  return t('organizer.aiAssistant.readable.seededFrom', {
    phase: phaseTypeWord(value.type, t),
    tournament: value.tournament,
  });
}

function poolsSentence(
  action: Extract<ReadableDraftAction, { kind: 'generate_pools' }>,
  t: Translator,
): string {
  const tournament = tournamentName(action.tournament, t);
  const { poolCount, targetSize } = action;
  if (poolCount === 1) return t('organizer.aiAssistant.readable.poolsOne', { tournament });
  if (poolCount !== undefined) {
    return t('organizer.aiAssistant.readable.poolsCount', { count: poolCount, tournament });
  }
  if (targetSize !== undefined) {
    return t('organizer.aiAssistant.readable.poolsSize', { size: targetSize, tournament });
  }
  return t('organizer.aiAssistant.readable.pools', { tournament });
}

function scheduleSentence(
  action: Extract<ReadableDraftAction, { kind: 'schedule_match' }>,
  t: Translator,
  bcp47: string,
): string {
  const where = {
    match: matchName(action.match, t),
    piste: isMissing(action.piste)
      ? t('organizer.aiAssistant.readable.missing.piste')
      : action.piste.name,
  };
  const time = formatInZone(action.startsAt, action.timezone, START, bcp47);
  return time
    ? t('organizer.aiAssistant.readable.schedule', { ...where, time })
    : t('organizer.aiAssistant.readable.scheduleNoTime', where);
}

function assignSentence(
  action: Extract<ReadableDraftAction, { kind: 'assign_referee' }>,
  t: Translator,
): string {
  const who = {
    referee: isMissing(action.referee)
      ? t('organizer.aiAssistant.readable.missing.referee')
      : action.referee.name,
    role: isMissing(action.role)
      ? t('organizer.aiAssistant.readable.missing.role')
      : action.role.name,
  };
  const target = action.pool
    ? poolName(action.pool, t)
    : action.match
      ? matchName(action.match, t)
      : null;
  return target
    ? t('organizer.aiAssistant.readable.assignTo', { ...who, target })
    : t('organizer.aiAssistant.readable.assign', who);
}
