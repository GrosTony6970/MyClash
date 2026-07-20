/**
 * The tournament `ruleset_config` DTO and the engine schema must agree.
 *
 * They did not. The DTO accepted `z.number().min(0).max(20)` for winBonus and
 * both targets, while TFv1ConfigSchema required `.int().positive()` — so three
 * organizer spinners whose own inputs offered 0 sent a value the save then
 * rejected with a raw Zod message from a different layer. And a target above
 * 10 passed both, then produced a scoring button that 400s the exchange POST,
 * which the offline queue drops as terminal.
 *
 * This file pins the agreement in both directions: anything the DTO accepts
 * must parse in the engine, and anything the engine cannot use must be
 * rejected at the DTO, where the operator is present to fix it.
 */
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { TFv1ConfigSchema, MAX_AUTHORED_TARGET_VALUE } from '@myclash/rulesets';
import { UpdateTournamentDto } from './events.dto';

/** The zod schema behind the DTO class, as nestjs-zod exposes it. */
const schema = (UpdateTournamentDto as unknown as { schema: ZodTypeAny }).schema;

function parseConfig(rulesetConfig: unknown) {
  return schema.safeParse({ rulesetConfig });
}

describe('tournament rulesetConfig — DTO/engine agreement', () => {
  it('accepts a win bonus of zero, and the engine accepts it too', () => {
    // "Wins carry no bonus; score is purely the hits ratio" is a real rule, and
    // the spinner has always offered 0. The engine was the one that had to move.
    expect(parseConfig({ winBonus: 0 }).success).toBe(true);
    expect(TFv1ConfigSchema.parse({ winBonus: 0 }).winBonus).toBe(0);
  });

  it('rejects a non-integer win bonus rather than passing it to the engine', () => {
    expect(parseConfig({ winBonus: 1.5 }).success).toBe(false);
    expect(() => TFv1ConfigSchema.parse({ winBonus: 1.5 })).toThrow();
  });

  it('rejects a zero-point target at the DTO, not deep in a Zod parse', () => {
    // A 0-point target seeds a button with value 0, which createExchangeSchema
    // rejects (firstStrikeValue min 1).
    expect(parseConfig({ targetValues: { deepTarget: 0 } }).success).toBe(false);
    expect(parseConfig({ targets: [{ name: 'Nothing', value: 0 }] }).success).toBe(false);
  });

  it('rejects a target above the exchange cap', () => {
    const tooBig = MAX_AUTHORED_TARGET_VALUE + 1;
    expect(parseConfig({ targetValues: { deepTarget: tooBig } }).success).toBe(false);
    expect(parseConfig({ targets: [{ name: 'Huge', value: tooBig }] }).success).toBe(false);
    expect(
      parseConfig({ targets: [{ name: 'Max', value: MAX_AUTHORED_TARGET_VALUE }] }).success,
    ).toBe(true);
  });

  it('accepts named targets of any count', () => {
    expect(
      parseConfig({
        targets: [
          { name: 'Head', value: 3 },
          { name: 'Torso', value: 2 },
          { name: 'Limb', value: 1 },
        ],
      }).success,
    ).toBe(true);
    expect(parseConfig({ targets: [{ name: 'Hit', value: 1 }] }).success).toBe(true);
  });

  it('rejects an unnamed target', () => {
    expect(parseConfig({ targets: [{ value: 2 }] }).success).toBe(false);
    expect(parseConfig({ targets: [{ name: '   ', value: 2 }] }).success).toBe(false);
  });

  it('rejects a fractional disqualifyAfter, which counts forfeits', () => {
    expect(parseConfig({ tournamentPolicy: { disqualifyAfter: 2.5 } }).success).toBe(false);
    expect(parseConfig({ tournamentPolicy: { disqualifyAfter: 2 } }).success).toBe(true);
  });

  it('still rejects an unknown key — the schema is strict', () => {
    // The Advanced tab 400'd on every save for months by writing `forfeitPolicy`
    // instead of `tournamentPolicy`; strictness is what surfaced it.
    expect(parseConfig({ forfeitPolicy: { forfeitDrawsCount: true } }).success).toBe(false);
  });

  it('round-trips everything it accepts through the engine schema', () => {
    const config = {
      winBonus: 0,
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Body', value: 1 },
      ],
      targetValues: { deepTarget: 3, shallowTarget: 1 },
      tournamentPolicy: { disqualifyAfter: 3 },
    };
    expect(parseConfig(config).success).toBe(true);
    const parsed = TFv1ConfigSchema.parse(config);
    expect(parsed.winBonus).toBe(0);
    expect(parsed.targets).toHaveLength(2);
  });
});
