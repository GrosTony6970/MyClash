'use client';

import { useState } from 'react';
import { Button } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { NewPasswordFields, NewPasswordPanel } from '@/components/NewPasswordPanel';
import {
  clubAnswer,
  isClubOutcome,
  type ClubBody,
  type ClubOutcome,
  type ClubRefusal,
} from './club-answer';

type Translate = (key: string) => string;
type Shown = { kind: 'form' } | ClubOutcome;

/** What the mailed link carries, besides its code: the club, and the versions she accepted. */
const LINK_FIELDS = ['orgName', 'orgSlug', 'acceptedTerms', 'acceptedPrivacy'] as const;

/**
 * The page an organiser's sign-up mail opens (ruling "Pre-takeover"): she chooses her password
 * here, once her address is proven, and her club is made then. Opening it sends nothing. ONE
 * request spends the code, writes the password, signs her in and makes the club; the page then
 * opens the club the door made (rulings 299, 304, 369).
 *
 * The address is read in a lazy initializer, as the reset page reads its token, not through
 * `useSearchParams`: nothing that depends on it is drawn before the submit.
 */
export default function OrganizerChoosePasswordPage() {
  const { t } = useI18n();
  const [link] = useState<URLSearchParams | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search),
  );
  const [shown, setShown] = useState<Shown>({ kind: 'form' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ClubRefusal | 'no-token' | null>(null);

  async function submit(password: string): Promise<void> {
    const token = link?.get('token_hash');
    if (!link || !token || LINK_FIELDS.some((field) => !link.get(field))) {
      setRefusal('no-token');
      return;
    }
    setBusy(true);
    setRefusal(null);
    const answer = await sendChoice(link, token, password);
    if (answer.kind === 'opened') {
      // Busy until the page leaves: a second press would send the spent code.
      window.location.href = answer.next;
      return;
    }
    setBusy(false);
    if (isClubOutcome(answer)) setShown(answer);
    else setRefusal(answer);
  }

  return (
    <NewPasswordPanel t={t}>
      {shown.kind === 'form' ? (
        <>
          <h2 className="text-2xl font-black">{t('auth.choosePassword.title')}</h2>
          <p className="text-sm leading-6 text-muted">{t('auth.choosePassword.description')}</p>
          <NewPasswordFields
            t={t}
            submitLabel={t('auth.choosePassword.submit')}
            busy={busy}
            error={refusalWords(refusal, t)}
            onSubmit={(password) => void submit(password)}
          />
        </>
      ) : (
        <Outcome t={t} shown={shown} />
      )}
    </NewPasswordPanel>
  );
}

/** ONE request: the door spends the code, writes the password, signs her in, makes the club. */
async function sendChoice(link: URLSearchParams, token: string, password: string) {
  const club = Object.fromEntries(LINK_FIELDS.map((field) => [field, link.get(field) ?? '']));
  const result = await apiRequest<ClubBody | undefined>(
    getPublicApiUrl(),
    '/api/v1/auth/signup-choose-password',
    {
      method: 'POST',
      body: { token_hash: token, password, ...club },
      signal: AbortSignal.timeout(15000),
    },
  );
  return clubAnswer(result);
}

/** The sentence the form stays open on, or none. */
function refusalWords(refusal: ClubRefusal | 'no-token' | null, t: Translate): string | null {
  if (!refusal) return null;
  if (refusal === 'no-token') return t('auth.choosePassword.errors.missingToken');
  if (refusal.kind === 'refused') return t(refusal.key);
  if (refusal.kind === 'weak') return t('admin.common.passwordMinLength');
  if (refusal.kind === 'network') return t('auth.resetPassword.errors.network');
  return t('auth.choosePassword.errors.generic');
}

/**
 * The code is spent. `restart`: no club stands, a second sign-up is the way on. `sign-in`: the
 * club is made and the password saved, but no login was handed (ruling 358). `not-saved` /
 * `unknown`: the club is made and she is signed in by the code, the password was refused or not
 * judged: "Forgot password?" on the sign-in page sets one later.
 */
function Outcome({ t, shown }: { t: Translate; shown: ClubOutcome }) {
  if (shown.kind === 'restart') {
    return (
      <>
        <h2 className="text-2xl font-black">{t('auth.choosePassword.title')}</h2>
        <p className="text-sm leading-6 text-muted" role="status">
          {t(shown.key)}
        </p>
        <Button asChild variant="primary" className="w-full py-3">
          <a href="/signup">{t('auth.choosePassword.signUpAgain')}</a>
        </Button>
      </>
    );
  }
  if (shown.kind === 'sign-in') {
    return (
      <>
        <h2 className="text-2xl font-black">{t('auth.choosePassword.title')}</h2>
        <p className="text-sm leading-6 text-muted">{t('auth.choosePassword.doneSignIn')}</p>
        <Button asChild variant="primary" className="w-full py-3">
          <a href="/login">{t('auth.login.signIn')}</a>
        </Button>
      </>
    );
  }
  return (
    <>
      <h2 className="text-2xl font-black">{t('auth.choosePassword.title')}</h2>
      <p className="text-sm leading-6 text-muted" role="status">
        {shown.kind === 'not-saved'
          ? t('auth.choosePassword.notSaved')
          : t('auth.choosePassword.unknown')}
      </p>
      <Button asChild variant="primary" className="w-full py-3">
        <a href={shown.next}>{t('auth.choosePassword.openClub')}</a>
      </Button>
    </>
  );
}
