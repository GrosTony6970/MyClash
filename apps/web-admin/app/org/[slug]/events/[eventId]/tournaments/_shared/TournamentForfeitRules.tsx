'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  mergeForfeitRules,
  type ForfeitChanges,
  type ForfeitPatch,
} from '@myclash/types/forfeit-rules';
import { ModifiedBadge, ResetLink } from '@/components/ModifiedBadge';
import {
  ForfeitRulesFields,
  type ForfeitAffordance,
} from '@/components/rulesets/ForfeitRulesFields';
import {
  editedForm,
  FORFEIT_LEAVES,
  isChanged,
  leafOf,
  resetLeaf,
  type ForfeitLeaf,
} from '@/components/rulesets/forfeit-leaves';
import type { ForfeitRulesShown } from './useForfeitRules';

interface Props {
  shown: ForfeitRulesShown | null;
  /** The Tournament's changes as last read or saved. */
  saved: ForfeitChanges | null;
  /** The changes in the host's form: a leaf at null is a Reset not saved yet. */
  value: ForfeitPatch | null;
  onChange: (next: ForfeitPatch | null) => void;
  disabled: boolean;
}

/**
 * A Tournament's forfeit rules (rulings 65 and 70): its penalty ruleset's, with the Tournament's
 * own changes laid over them by the one merge, each change badged, with its Reset. The host owns
 * the form and sends it with its save (`patchOf`); the server locks it once a bout has started
 * (ruling 73).
 */
export function TournamentForfeitRules({ shown, saved, value, onChange, disabled }: Props) {
  const { t } = useI18n();
  if (!shown) return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (shown.failed) {
    return <p className="text-sm text-danger">{t('admin.orgTournaments.rulesReadFailed')}</p>;
  }
  const closed = disabled || shown.readOnly;
  const reset = (leaf: ForfeitLeaf) => onChange(resetLeaf(value, saved, leaf));
  if (!shown.ruleset || shown.invalid) {
    return (
      <InvalidChanges
        rulesetInvalid={!shown.ruleset}
        saved={saved}
        value={value}
        onReset={closed ? null : reset}
      />
    );
  }
  const ruleset = shown.ruleset;
  const rules = mergeForfeitRules(ruleset, value);
  const affordance: ForfeitAffordance = (leaf, label) => {
    if (!isChanged(value, leaf)) return null;
    const startLabel = label(leafOf(ruleset, leaf));
    return (
      <>
        <ModifiedBadge startLabel={startLabel} />
        {!closed && <ResetLink startLabel={startLabel} onReset={() => reset(leaf)} />}
      </>
    );
  };
  return (
    <div className="space-y-2">
      {shown.readOnly && (
        <p className="text-xs text-muted">{t('admin.orgTournaments.forfeitRulesPinnedOnly')}</p>
      )}
      <ForfeitRulesFields
        value={rules}
        onChange={(next) => onChange(editedForm(value, rules, next, { ruleset, saved }))}
        disabled={closed}
        affordance={affordance}
        help={t('admin.orgTournaments.forfeitRulesHelp')}
        withCardSelects
      />
    </div>
  );
}

/** The words of a leaf: its reason and field, or the setting it is. */
function useLeafLabel() {
  const { t } = useI18n();
  const SETTING: Record<string, string> = {
    disqualifyAfter: t('admin.penaltyRulesets.forfeits.disqualifyAfter'),
    disqualifyBeforeFirstBout: t('admin.penaltyRulesets.forfeits.beforeFirstBout'),
    blackCardOpponentScore: t('admin.penaltyRulesets.forfeits.blackCardScore'),
    firstBlackCard: t('admin.penaltyRulesets.firstBlackCardForfeit'),
    secondBlackCard: t('admin.penaltyRulesets.secondBlackCardForfeit'),
    outcome: t('admin.penaltyRulesets.forfeits.outcome'),
    opponentScore: t('admin.penaltyRulesets.forfeits.opponentScore'),
    fighter: t('admin.penaltyRulesets.forfeits.fighter'),
  };
  return (leaf: ForfeitLeaf) =>
    leaf.length === 3
      ? t('admin.orgTournaments.forfeitReasonField', {
          reason: t(`admin.penaltyRulesets.forfeits.reason.${leaf[1]}`),
          field: SETTING[leaf[2]!]!,
        })
      : SETTING[leaf[0]!]!;
}

/**
 * Stored rules that do not parse (only a hand-edited archive can store them): said, and each
 * stored change offers its Reset, so the one block that can clear a bad change still opens. The
 * server says which part failed: no `ruleset` is the penalty ruleset's own rules, which no Reset
 * here fixes.
 */
function InvalidChanges({
  rulesetInvalid,
  saved,
  value,
  onReset,
}: {
  rulesetInvalid: boolean;
  saved: ForfeitChanges | null;
  value: ForfeitPatch | null;
  onReset: ((leaf: ForfeitLeaf) => void) | null;
}) {
  const { t } = useI18n();
  const labelOf = useLeafLabel();
  const held = FORFEIT_LEAVES.filter(
    (leaf) => leafOf(saved, leaf) !== undefined && leafOf(value, leaf) !== null,
  );
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
      <p>
        {rulesetInvalid
          ? t('admin.orgTournaments.forfeitRulesetInvalid')
          : t('admin.orgTournaments.forfeitRulesInvalid')}
      </p>
      <ul className="mt-2 space-y-1">
        {held.map((leaf) => (
          <li key={leaf.join('.')} className="flex items-center gap-2 text-xs">
            {labelOf(leaf)}
            {onReset && (
              <ResetLink
                startLabel={t('admin.orgTournaments.forfeitRulesetValue')}
                onReset={() => onReset(leaf)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
