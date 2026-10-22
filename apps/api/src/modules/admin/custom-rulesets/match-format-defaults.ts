/**
 * The ONE check of a match format a ruleset stores as its own (operator rulings 59 and 141,
 * 2026-10-20/22): `match_format_defaults` on a club formula ruleset, `tf_config.matchFormat` on TF_v1
 * and its copies. The editor sends only the fields the author changed, so a stored format is
 * PARTIAL and is stored raw; what it does not hold is read from the engine's defaults.
 *
 * A key the schema does not name is refused rather than dropped: a typo would be stored and never
 * read, and a legacy key (`firstToPoints`, `timeLimitSeconds`, `maxDoubles`) would override the
 * field the editor shows when a Tournament is seeded (`normalizeMatchFormatConfig`).
 */
import { BadRequestException } from '@nestjs/common';
import { MatchFormatConfigSchema, normalizeMatchFormatConfig } from '@myclash/rulesets';
import { inEngineWords } from '../../events/tournament-config';

const TOP_KEYS = Object.keys(MatchFormatConfigSchema.shape);

/** The keys of each leaf that is itself an object. */
const INNER_KEYS: Record<string, string[]> = {
  timeLimitsSeconds: Object.keys(MatchFormatConfigSchema.shape.timeLimitsSeconds.unwrap().shape),
  bestOf: Object.keys(MatchFormatConfigSchema.shape.bestOf.unwrap().shape),
  levelAtTime: Object.keys(MatchFormatConfigSchema.shape.levelAtTime.unwrap().shape),
};

function unknownKeys(format: Record<string, unknown>): string[] {
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(format)) {
    if (!TOP_KEYS.includes(key)) {
      unknown.push(key);
      continue;
    }
    const inner = INNER_KEYS[key];
    if (!inner || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    for (const innerKey of Object.keys(value)) {
      if (!inner.includes(innerKey)) unknown.push(`${key}.${innerKey}`);
    }
  }
  return unknown;
}

/** The format to store: null for none, else the author's own keys as sent. A 400 otherwise. */
export function validateMatchFormatDefaults(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('A match format must be an object');
  }
  const format = raw as Record<string, unknown>;
  const unknown = unknownKeys(format);
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown match format setting: ${unknown.join(', ')}`);
  }
  inEngineWords(() => normalizeMatchFormatConfig(format));
  return format;
}
