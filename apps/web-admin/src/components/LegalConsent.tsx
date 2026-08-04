'use client';

import { useI18n } from '../i18n/I18nProvider';
import { getLegalUrl } from '../lib/legal-url';

/**
 * Renders a sentence containing `{terms}` and `{privacy}` with those two tokens
 * replaced by real links.
 *
 * `t()` interpolates strings, not elements, so the template is split here
 * instead. Splitting on a regex that captures both tokens keeps the sentence
 * order under the translator's control — French puts "la politique de
 * confidentialité" in a different place, and a hardcoded
 * `label + link + link` order would silently render nonsense there.
 */
function renderWithPolicyLinks(
  template: string,
  labels: { terms: string; privacy: string },
  hrefs: { terms: string; privacy: string },
) {
  return template.split(/(\{terms\}|\{privacy\})/g).map((part, index) => {
    if (part !== '{terms}' && part !== '{privacy}') return <span key={index}>{part}</span>;
    const kind = part === '{terms}' ? 'terms' : 'privacy';
    return (
      <a
        key={index}
        href={hrefs[kind]}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:text-accent"
        // Stops a click on the link from toggling the checkbox it sits inside.
        onClick={(event) => event.stopPropagation()}
      >
        {labels[kind]}
      </a>
    );
  });
}

export interface LegalConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

/**
 * The agreement checkbox every account-creation form carries. Its state is the
 * form's, not this component's: the submit handler needs to refuse without it,
 * and a checkbox that owned its own state could not be re-read on submit.
 */
export function LegalConsent({ checked, onChange, id = 'legal-consent' }: LegalConsentProps) {
  const { t, locale } = useI18n();
  const labels = { terms: t('legal.terms'), privacy: t('legal.privacy') };
  const hrefs = {
    terms: getLegalUrl('terms', locale),
    privacy: getLegalUrl('privacy', locale),
  };

  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm text-foreground-secondary">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <span>{renderWithPolicyLinks(t('legal.accept.label'), labels, hrefs)}</span>
    </label>
  );
}

/**
 * The same sentence without a checkbox, for the guest path where the user is
 * informed rather than gated.
 */
export function LegalNotice({ className = '' }: { className?: string }) {
  const { t, locale } = useI18n();
  const labels = { terms: t('legal.terms'), privacy: t('legal.privacy') };
  const hrefs = {
    terms: getLegalUrl('terms', locale),
    privacy: getLegalUrl('privacy', locale),
  };
  return (
    <p className={['text-xs text-muted', className].join(' ')}>
      {renderWithPolicyLinks(t('legal.guestNotice'), labels, hrefs)}
    </p>
  );
}
