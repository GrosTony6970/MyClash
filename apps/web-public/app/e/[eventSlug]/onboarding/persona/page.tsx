/* eslint-disable myclash/no-literal-string -- pre-T-1401 page; i18n strings tracked in backlog */
'use client';

/**
 * Persona selection — T-603
 * Route: /e/[eventSlug]/onboarding/persona
 *
 * Multi-select persona hints. Stored on the guest session.
 * Personas are hints only — actual capabilities come from registrations.
 *
 * AC:
 *   - Multi-select: Competitor, Referee, Workshop Attendee, Accompanist, Public
 *   - "Send me a login link" calls /persons/:id/request-claim
 *   - Redirect to /e/[eventSlug]/home after save
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Persona = 'competitor' | 'referee' | 'workshop_attendee' | 'accompanist' | 'public';

interface PersonaOption {
  id: Persona;
  label: string;
  sublabel: string;
  emoji: string;
}

const PERSONAS: PersonaOption[] = [
  {
    id: 'competitor',
    label: 'Competitor',
    sublabel: "I'm fighting in this event",
    emoji: '⚔️',
  },
  {
    id: 'referee',
    label: 'Referee',
    sublabel: "I'm officiating matches",
    emoji: '🏛️',
  },
  {
    id: 'workshop_attendee',
    label: 'Workshop Attendee',
    sublabel: "I'm attending workshops",
    emoji: '📚',
  },
  {
    id: 'accompanist',
    label: 'Accompanist',
    sublabel: "I'm here to support someone",
    emoji: '👥',
  },
  {
    id: 'public',
    label: 'Public',
    sublabel: "I'm watching the event",
    emoji: '👁️',
  },
];

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export default function PersonaPage({ params }: Props) {
  const router = useRouter();
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<Persona>>(new Set());
  const [saving, setSaving] = useState(false);
  const [claimSent, setClaimSent] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  useEffect(() => {
    void params.then(({ eventSlug: slug }) => setEventSlug(slug));
  }, [params]);

  function toggle(persona: Persona) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(persona)) next.delete(persona);
      else next.add(persona);
      return next;
    });
  }

  async function handleSave() {
    if (!eventSlug) return;
    setSaving(true);

    try {
      // PATCH /api/v1/guest-sessions/me/personas
      await fetch(`${apiUrl}/api/v1/guest-sessions/me/personas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ personas: Array.from(selected) }),
      });
      // Non-fatal if endpoint not yet implemented — proceed to home
    } catch {
      // Swallow — personas are hints, not critical
    } finally {
      setSaving(false);
    }

    router.push(`/e/${eventSlug}/home`);
  }

  async function handleRequestClaim() {
    setClaimError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'claim' }),
      });
      if (!res.ok) throw new Error('Failed to send link');
      setClaimSent(true);
    } catch {
      setClaimError('Could not send link. Try again later.');
    }
  }

  if (!eventSlug) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main id="main-content" className="flex min-h-screen flex-col px-4 py-8 max-w-md mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl font-bold mb-1"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          How are you here today?
        </h1>
        <p className="text-gray-400 text-sm">Select all that apply. You can change this later.</p>
      </div>

      {/* Persona grid */}
      <div className="flex flex-col gap-3 mb-8">
        {PERSONAS.map((p) => {
          const isSelected = selected.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className="flex items-center gap-4 px-4 py-4 rounded-xl border-2 text-left transition-colors"
              style={
                isSelected
                  ? {
                      borderColor: 'var(--event-primary, #c0392b)',
                      backgroundColor:
                        'color-mix(in srgb, var(--event-primary, #c0392b) 15%, transparent)',
                    }
                  : { borderColor: '#374151' }
              }
              aria-pressed={isSelected}
            >
              <span className="text-2xl flex-shrink-0" aria-hidden="true">
                {p.emoji}
              </span>
              <div className="flex-1">
                <p className="font-semibold text-white">{p.label}</p>
                <p className="text-sm text-gray-400">{p.sublabel}</p>
              </div>
              <span
                className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                style={
                  isSelected
                    ? {
                        borderColor: 'var(--event-primary, #c0392b)',
                        backgroundColor: 'var(--event-primary, #c0392b)',
                      }
                    : { borderColor: '#4b5563' }
                }
              >
                {isSelected && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Note: personas are hints */}
      <p className="text-xs text-gray-600 mb-6">
        These are hints to personalise your experience. Your actual access is determined by your
        registrations and qualifications.
      </p>

      {/* Save button */}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        aria-busy={saving || undefined}
        className="w-full py-4 rounded-xl font-bold text-lg text-white mb-4 disabled:opacity-50 transition-colors"
        style={{ backgroundColor: 'var(--event-primary, #c0392b)' }}
      >
        {saving ? 'Saving…' : selected.size === 0 ? 'Skip for now' : 'Continue →'}
      </button>

      {/* Claim link */}
      <div className="border-t border-gray-800 pt-4">
        {claimSent ? (
          <p className="text-sm text-green-400 text-center">
            ✓ Login link sent to your registered email.
          </p>
        ) : (
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">
              Want to access your account from any device?
            </p>
            <button
              onClick={() => void handleRequestClaim()}
              aria-describedby={claimError ? 'claim-error' : undefined}
              className="text-sm underline text-gray-400 hover:text-white transition-colors"
            >
              Send me a login link
            </button>
            {claimError && (
              <p id="claim-error" className="text-xs text-red-400 mt-1">
                {claimError}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
