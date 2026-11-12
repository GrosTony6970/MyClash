'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { AgreedSpar } from '@myclash/types';
import { Button } from '@myclash/ui';
import { useNow } from './use-now';
import { useSparAfter, type AfterHandlers, type ReviewInput } from './use-spar-after';

const TEXT_BOX =
  'mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent';

/** A moment as the reader's language writes it, on their own clock. */
function useMomentLabel(): (iso: string) => string {
  const { locale } = useI18n();
  return (iso) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
}

/** Stars 1-5 as a radio group, each with an accessible name. */
function StarPicker(props: { value: number; onChange: (stars: number) => void }) {
  const { t } = useI18n();
  const name = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="sr-only">{t('publicApp.fightBook.after.starsLabel')}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="flex items-center gap-1 text-foreground">
          <input
            type="radio"
            name={name}
            value={n}
            checked={props.value === n}
            onChange={() => props.onChange(n)}
            aria-label={t('publicApp.fightBook.after.starOption', { stars: String(n) })}
          />
          <span aria-hidden="true">{`★ ${n}`}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Stars, a few words, "without my name" (which hides the words), Send. */
function ReviewForm(props: { busy: boolean; onSend: (review: ReviewInput) => void }) {
  const { t } = useI18n();
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="font-semibold text-foreground">{t('publicApp.fightBook.after.formTitle')}</p>
      <StarPicker value={stars} onChange={setStars} />
      {anonymous ? null : (
        <label className="text-foreground">
          {t('publicApp.fightBook.after.textLabel')}
          <textarea
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={TEXT_BOX}
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-foreground">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        {t('publicApp.fightBook.after.anonymous')}
      </label>
      <div>
        <Button
          type="button"
          disabled={props.busy || stars === 0}
          onClick={() => props.onSend({ stars, text, anonymous })}
        >
          {t('publicApp.fightBook.after.send')}
        </Button>
      </div>
    </div>
  );
}

/** The private note: saved on "Save", cleared by saving it empty. */
function NoteBox(props: { saved: string | null; busy: boolean; onSave: (text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(props.saved ?? '');
  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="text-foreground">
        {t('publicApp.fightBook.after.noteLabel')}
        <textarea
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={TEXT_BOX}
        />
      </label>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={props.busy}
          onClick={() => props.onSave(text)}
        >
          {t('publicApp.fightBook.after.noteSave')}
        </Button>
      </div>
    </div>
  );
}

/** What the partner wrote to me (signed only) and what I wrote to them. */
function Thanks({ spar }: { spar: AgreedSpar }) {
  const { t } = useI18n();
  const { myReview, theirThanks } = spar;
  const name = spar.partner.name || t('publicApp.fightBook.unknownFighter');
  const stars = (n: number) => ({ stars: String(n) });
  return (
    <>
      {theirThanks ? (
        <div className="mt-1">
          <p className="font-semibold text-foreground">
            {t('publicApp.fightBook.after.theirThanks', { name, stars: String(theirThanks.stars) })}
          </p>
          {theirThanks.text ? <p className="italic text-muted">{theirThanks.text}</p> : null}
        </div>
      ) : null}
      {myReview ? (
        <div className="mt-1">
          <p className="text-foreground">
            {myReview.anonymous
              ? t('publicApp.fightBook.after.yourAnonymous', stars(myReview.stars))
              : t('publicApp.fightBook.after.yourThanks', stars(myReview.stars))}
          </p>
          {myReview.text ? <p className="italic text-muted">{myReview.text}</p> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Under an agreed or done card: "We sparred" from the spar day, "Undo" until the window shuts,
 * then the thank-you form, and a private note on a done spar. The page compares the windows with
 * its own clock to decide what to offer; the API decides what is accepted, and a refusal is said.
 */
export function SparAfter(props: { apiUrl: string; spar: AgreedSpar } & AfterHandlers) {
  const { t } = useI18n();
  const { apiUrl, spar, ...handlers } = props;
  const momentLabel = useMomentLabel();
  const now = useNow([spar.markFrom, spar.markUntil]);
  const after = useSparAfter(apiUrl, spar.id, handlers);
  const closed = now >= Date.parse(spar.markUntil);
  const open = !closed && now >= Date.parse(spar.markFrom);
  if (spar.status === 'cancelled') return null;
  return (
    <div className="mt-2">
      {after.refusal ? (
        <p role="alert" className="text-danger">
          {after.refusal}
        </p>
      ) : null}
      {spar.status === 'agreed' && open ? (
        <Button type="button" disabled={after.busy} onClick={() => void after.mark()}>
          {t('publicApp.fightBook.after.weSparred')}
        </Button>
      ) : null}
      {spar.status === 'done' ? (
        <>
          {!closed ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted">
                {t('publicApp.fightBook.after.markedUntil', { when: momentLabel(spar.markUntil) })}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={after.busy}
                onClick={() => void after.undo()}
              >
                {t('publicApp.fightBook.after.undo')}
              </Button>
            </div>
          ) : null}
          <Thanks spar={spar} />
          {closed && !spar.myReview ? (
            <ReviewForm busy={after.busy} onSend={(review) => void after.review(review)} />
          ) : null}
          <NoteBox saved={spar.note} busy={after.busy} onSave={(text) => void after.note(text)} />
        </>
      ) : null}
    </div>
  );
}
