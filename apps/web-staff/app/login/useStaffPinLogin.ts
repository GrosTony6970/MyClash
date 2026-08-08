'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import { api } from '../../src/lib/api';
import { resolveSelectedEvent, type PickerEvent } from '../../src/components/picker-events';
import { usePickerEvents } from '../../src/lib/usePickerEvents';
import { rememberEvent, useRememberedEvent } from '../../src/lib/last-event';
import { landingPathForRole } from '../../src/lib/landing';

/**
 * Everything the PIN sign-in form does, so the component itself is markup.
 *
 * The event resolution here is the part worth reading. Three sources can name
 * the event, in this precedence:
 *
 *   1. what the volunteer typed (only reachable when the picker found nothing)
 *   2. what they picked, or what this tablet remembers
 *   3. `?event=` off the link the organiser printed
 *
 * The link is LAST because it is also the only case where the picker never
 * renders, so it can never be overridden by a choice that was not offered.
 */
export function useStaffPinLogin(linkedEvent: string, linkedUsername: string) {
  const { t } = useI18n();
  const pinRef = useRef<HTMLInputElement>(null);
  const event = useEventChoice(linkedEvent);

  // `null` means "untouched, follow the link"; typing takes over from there, so
  // the prefill needs no setState-in-an-effect.
  const [usernameEdit, setUsernameEdit] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const username = usernameEdit ?? linkedUsername;

  // A fully addressed link leaves exactly one thing to type.
  useEffect(() => {
    if (linkedEvent && linkedUsername) pinRef.current?.focus();
  }, [linkedEvent, linkedUsername]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await signIn(event.eventSlugOrCode, event.selected, username, pin);
      // The role decides the destination, and it comes off the login response
      // because the mc_staff token carries none.
      window.location.href = landingPathForRole(me?.account?.role);
    } catch {
      setError(t('scoring.login.localLoginError'));
    } finally {
      setLoading(false);
    }
  }

  return { ...event, username, pin, error, loading, pinRef, setUsernameEdit, setPin, submit };
}

/**
 * POST the credentials, and remember the event only on SUCCESS.
 *
 * The ordering matters: a typo'd event that failed to authenticate must not
 * become this tablet's default for tomorrow morning.
 */
async function signIn(
  eventSlugOrCode: string,
  selected: PickerEvent | null,
  username: string,
  pin: string,
): Promise<StaffMe> {
  // The id goes when we have one. `events.slug` is unique per ORGANISATION, not
  // globally, so slug resolution is ambiguous across orgs; picking from the
  // list is the one path that always knows the id.
  const me = await api.post<StaffMe>('/api/v1/staff-auth/login', {
    eventSlugOrCode,
    ...(selected ? { eventId: selected.id } : {}),
    username,
    pin,
  });
  if (selected) rememberEvent({ id: selected.id, slug: selected.slug, name: selected.name });
  return me;
}

/** The login response — the same payload `/staff-auth/me` returns. */
interface StaffMe {
  account?: { role?: string };
}

/** Which event the volunteer is signing into, from the three possible sources. */
function useEventChoice(linkedEvent: string) {
  const [eventEdit, setEventEdit] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickerEvent | null>(null);

  // Fetched only when the link named no event: a printed QR code is the fast
  // path and must not pay for a list it will never show.
  const remembered = useRememberedEvent();
  const { events, loading: pickerLoading } = usePickerEvents(!linkedEvent);

  // Pre-SELECTED, never pre-submitted. A remembered event no longer in the list
  // resolves to nothing rather than arming the form with an off-screen answer.
  const selected = resolveSelectedEvent(events, picked, remembered?.id ?? null);

  return {
    events,
    pickerLoading,
    selected,
    eventSlugOrCode: eventEdit ?? selected?.slug ?? linkedEvent,
    setPicked,
    setEventEdit,
  };
}
