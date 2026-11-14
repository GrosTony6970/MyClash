'use client';

import { useRef, useState } from 'react';
import type { KnownTranslationKey } from '@myclash/i18n';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent } from '@myclash/types';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { signInAgainHere } from '@/lib/sign-in-return';

export type ScanPhase =
  { kind: 'form' | 'scanning' | 'sending' | 'sent' } | { kind: 'refused'; message: string };

/** The form: weapons, and where. Events are today's only; `where === ''` is "Somewhere else". */
function useScanForm(events: FightBookEvent[], catalog: string[]) {
  const [weapons, setWeapons] = useState<string[]>([]);
  const [pickedWhere, setWhere] = useState<string | null>(null);
  const [place, setPlace] = useState('');
  const where =
    pickedWhere !== null && (pickedWhere === '' || events.some((e) => e.id === pickedWhere))
      ? pickedWhere
      : (events[0]?.id ?? '');
  const ready = weapons.length > 0 && (where !== '' || place.trim() !== '');
  const toggle = (name: string) =>
    setWeapons((now) => (now.includes(name) ? now.filter((w) => w !== name) : [...now, name]));
  /** The body: an Event scan names no place or zone, a scan elsewhere names no Event. */
  const bodyFor = (code: string) => {
    const common = { code, weapons: catalog.filter((w) => weapons.includes(w)) };
    if (where !== '') return { ...common, eventId: where };
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { ...common, place: place.trim(), zone };
  };
  return { weapons, where, place, ready, toggle, setWhere, setPlace, bodyFor };
}

/**
 * A refused scan's sentence: the hour used up, or the refusal's own. `bad_event` names both
 * fighters here (ruling 760): either one may be off the Event, and the scanner is not told which.
 */
function scanRefusalKey(status: number | null, code: string | null): KnownTranslationKey {
  if (status === 429) return 'publicApp.fightBook.qr.throttled';
  if (code === 'bad_event') return 'publicApp.fightBook.qr.badEvent';
  return sparRefusalKey(code);
}

/**
 * The scan view's state. The form is filled BEFORE the camera opens, so the first `fb:` code the
 * camera reads can be sent at once. The camera stops with that send (`active` is true only while
 * `scanning`): it re-reads a held code every 4 s, and a refused code sent again would only feed
 * the throttle. `used` closes the one gap left: two codes read in the same frame, before the
 * state change reaches the camera.
 */
export function useQrScan(props: {
  apiUrl: string;
  events: FightBookEvent[];
  catalog: string[];
  onSent: () => void;
}) {
  const { t } = useI18n();
  const form = useScanForm(props.events, props.catalog);
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'form' });
  const used = useRef(false);
  const start = () => {
    used.current = false;
    setPhase({ kind: 'scanning' });
  };

  const submit = async (code: string) => {
    const res = await writeFightBook<{ id: string }>(
      props.apiUrl,
      '/api/v1/me/fightbook/qr/scan',
      'POST',
      form.bodyFor(code),
    );
    if (res.ok) {
      setPhase({ kind: 'sent' });
      return props.onSent();
    }
    if (res.status === 401) return signInAgainHere();
    setPhase({ kind: 'refused', message: t(scanRefusalKey(res.status, res.code)) });
  };

  const onToken = (token: string) => {
    if (!token.startsWith('fb:') || used.current) return;
    used.current = true;
    setPhase({ kind: 'sending' });
    void submit(token);
  };

  return { phase, ...form, start, onToken };
}
