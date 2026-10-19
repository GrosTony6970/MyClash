import type { RulesChangeNotice } from '@myclash/types';
import type { AppLocale } from '@myclash/time';
import type { Translator } from '@myclash/ui';
import { rulesChangesNoticeItems } from './rules-changes-notice';

interface Props {
  notices: readonly RulesChangeNotice[];
  t: Translator;
  locale: AppLocale;
  /** The Event's IANA timezone: each change's date is shown in it. */
  timezone: string;
}

/**
 * Every change to the Tournament's scoring rules, newest first, with its reason: a change of rules
 * is never silent (the reason is public by design). Nothing when the rules never changed.
 */
export function RulesChangesNotice({ notices, t, locale, timezone }: Props) {
  const items = rulesChangesNoticeItems(notices, t, { locale, timezone });
  if (items.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-5">
      <h2 className="mb-3 font-display text-lg font-semibold text-warning">
        {t('publicApp.rulesChange.heading')}
      </h2>
      <ol className="space-y-4">
        {items.map((item) => (
          <li key={item.key} className="text-sm text-foreground-secondary">
            <p className="font-medium text-foreground">
              {item.title} · {item.rules}
            </p>
            <p className="text-xs text-muted">{item.when}</p>
            {item.lines.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {item.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <p className="mt-2">{item.reason}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
