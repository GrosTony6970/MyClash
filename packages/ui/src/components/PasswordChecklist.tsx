import type { PasswordRule } from '@myclash/types';

/**
 * Static keys, not `t(\`common.passwordRules.${rule}\`)`: the i18n reverse
 * sweep reads dotted-path string literals out of packages/ui/src, and a
 * template-literal key is invisible to it — all five strings would be reported
 * as orphans and pruned out from under this component.
 */
const RULE_KEYS: ReadonlyArray<{ rule: PasswordRule; key: string }> = [
  { rule: 'length', key: 'common.passwordRules.length' },
  { rule: 'uppercase', key: 'common.passwordRules.uppercase' },
  { rule: 'lowercase', key: 'common.passwordRules.lowercase' },
  { rule: 'digit', key: 'common.passwordRules.digit' },
  { rule: 'special', key: 'common.passwordRules.special' },
];

export interface PasswordChecklistProps {
  /** `failing` straight off `validatePassword` from @myclash/types. */
  failing: readonly PasswordRule[];
  /**
   * Passed as a prop rather than read from a hook: packages/ui cannot reach an
   * app's I18nProvider, and this renders in web-admin and web-public both.
   */
  t: (key: string) => string;
  className?: string;
}

/**
 * The password rules, ticking as they are satisfied.
 *
 * A live checklist rather than an error after submit — the rule set is long
 * enough that "password does not meet the requirements" tells someone almost
 * nothing about which part to change.
 *
 * One owner: this existed as three near-identical local copies (web-public's
 * login, reset-password and me/security pages) and was missing entirely from
 * web-admin's signup, which hand-rolled an eight-character check instead.
 */
export function PasswordChecklist({ failing, t, className }: PasswordChecklistProps) {
  return (
    <ul className={className ?? 'space-y-1 text-xs'}>
      {RULE_KEYS.map(({ rule, key }) => {
        const failed = failing.includes(rule);
        return (
          <li key={rule} className={failed ? 'text-muted' : 'text-success'}>
            <span aria-hidden>{failed ? '○' : '✓'}</span> {t(key)}
          </li>
        );
      })}
    </ul>
  );
}
