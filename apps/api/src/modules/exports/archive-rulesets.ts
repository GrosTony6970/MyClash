import { BadRequestException } from '@nestjs/common';
import type { RulesetRegistry } from '@myclash/rulesets';
import { isSystemRuleset } from '../events/ruleset-defaults';
import { normalizeRulesetVersion } from '../events/ruleset-row-projection';
import type { SelectableRulesetsService } from '../rulesets/selectable-rulesets.service';
import type { ArchiveTables } from './archive.types';

/**
 * A restore is a door that sets a Tournament's ruleset pair, and a bout's. An
 * archive is a file anyone can edit, so a pair in it can name another club's
 * private ruleset; an honest restore into another organisation carries the
 * source club's own. Restored, that club's ruleset would score the target's
 * bouts and freeze for its owner. So a restore whose Tournaments, bouts or
 * copies of a bout's rules (0229, which a bout is scored by) name a pair the
 * target organisation may not keep is refused before anything is inserted
 * (ruling "Restore a pair", 2026-10-18): a built-in, or the club's own
 * or a shared ruleset at a version that still resolves (`restorable`), never a
 * reset to another engine. A failed read fails the restore: it is not a verdict.
 */
export async function assertRestoredRulesetsUsable(
  rulesets: { registry: RulesetRegistry; selectable: SelectableRulesetsService },
  data: ArchiveTables,
  organizationId: string,
  userId: string,
): Promise<void> {
  const pairs = new Map<string, { code: string; version: string }>();
  for (const row of [...data.tournaments, ...data.matches, ...data.matchRules]) {
    if (!('ruleset_code' in row)) continue;
    const code = row['ruleset_code'];
    const stored = 'ruleset_version' in row ? row['ruleset_version'] : '1.0.0';
    // Both columns are NOT NULL on a Tournament and a copy: anything but a string fails the insert
    // half-way. A bout row's pair is not inserted (0232), but an archive made before 0229 builds
    // its copy from it.
    if (typeof code !== 'string' || typeof stored !== 'string') {
      throw new BadRequestException(
        'This archive names a ruleset that is not a code and a version. Nothing was restored.',
      );
    }
    const version = normalizeRulesetVersion(stored);
    pairs.set(`${code}@${version}`, { code, version });
  }
  let withDrafts: boolean | undefined;
  for (const { code, version } of pairs.values()) {
    if (isSystemRuleset(rulesets.registry, code, version)) continue;
    withDrafts ??= await rulesets.selectable.draftsOfferedTo(userId);
    if (!(await rulesets.selectable.restorable(organizationId, code, version, { withDrafts }))) {
      throw new BadRequestException(
        `This archive names a ruleset this organisation may not use (${code} ${version}). Nothing was restored.`,
      );
    }
  }
}
