import { FORFEIT_REASON_LABEL_KEY } from '@/lib/forfeit-reason-label';

/**
 * One supporting line of a debrief section, as the server sends it (`post-event-report.ts`):
 * data, worded here in the reader's language. The server built these as English sentences, so a
 * French organiser read "unlabelled device: 3 refused, 1 still held (sequence)" (ruling 891).
 */
export type ReportDetail =
  | {
      kind: 'refusedDevice';
      label: string | null;
      refused: number;
      stillHeld: number;
      reasons: string[];
    }
  | { kind: 'silentDevice'; label: string | null }
  | { kind: 'tally'; code: string; count: number };

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** A tablet's refusal codes (`apps/web-staff/src/offline/quarantine-report.ts`). Literal keys. */
const REFUSAL_REASON_KEY: Readonly<Record<string, string>> = {
  match_closed: 'organizer.debrief.detail.refusalReason.match_closed',
  validation: 'organizer.debrief.detail.refusalReason.validation',
  sequence: 'organizer.debrief.detail.refusalReason.sequence',
  other: 'organizer.debrief.detail.refusalReason.other',
};

/** How the desk recorded an arrival (`event_arrivals.via`, 0174). Literal keys. */
const ARRIVAL_VIA_KEY: Readonly<Record<string, string>> = {
  search: 'organizer.debrief.detail.via.search',
  qr: 'organizer.debrief.detail.via.qr',
};

/** Which code list a section's tallies use. */
const TALLY_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  overrides: FORFEIT_REASON_LABEL_KEY,
  arrivals: ARRIVAL_VIA_KEY,
};

/** A code with a label is named; a code this page does not know yet is shown as it came. */
function named(code: string, keys: Readonly<Record<string, string>> | undefined, t: Translator) {
  const key = keys?.[code];
  return key ? t(key) : code;
}

export function detailLine(sectionKey: string, detail: ReportDetail, t: Translator): string {
  if (detail.kind === 'tally') {
    const label = named(detail.code, TALLY_KEYS[sectionKey], t);
    return t('organizer.debrief.detail.tally', { label, count: detail.count });
  }
  const name = detail.label ?? t('organizer.debrief.detail.unlabelledDevice');
  if (detail.kind === 'silentDevice') return name;
  const parts = [t('organizer.debrief.detail.refused', { name, refused: detail.refused })];
  if (detail.stillHeld > 0) {
    parts.push(t('organizer.debrief.detail.stillHeld', { count: detail.stillHeld }));
  }
  const reasons = detail.reasons.map((code) => named(code, REFUSAL_REASON_KEY, t));
  const line = parts.join(' · ');
  return reasons.length > 0 ? `${line} (${reasons.join(', ')})` : line;
}
