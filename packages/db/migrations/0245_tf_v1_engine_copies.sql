-- 0245: TF_v1's row stops holding the engine's own values (operator rulings 61 and 135,
-- 2026-10-20/22).
--
-- THE DEFECT. 0053 seeded TF_v1's `tf_config` with copies of the engine's values (win bonus 3,
-- target values 2/1, double penalty 'n*(n-1)/3', and a match format 0072 later overwrote with the
-- engine's 10 / 90 / 5 / 4). The seed reads `tf_config` OVER the engine's defaults
-- (`resolveRulesetConfigDefaults`), so a frozen copy is a value nobody chose: it would stay put if
-- the engine moved, and the ruleset editor shows each stored value as the ruleset's own.
--
-- WHAT CHANGES. Each leaf of TF_v1's `tf_config` that still holds the engine's value is removed;
-- the row keeps only what a platform admin changed. Equality is exact (`=`, never `@>`, which
-- reads arrays as an order-blind subset), so a deliberate value is kept, and a key 0053 or 0072
-- never wrote (`bestOf`, `levelAtTime`, the Swiss time) is not touched. `targets`: 0053 never
-- wrote it, but the editor before this slice wrote it on every TF_v1 Save. Nothing scores
-- differently: an absent leaf reads as the same engine value. The flat `targets` column stays (the
-- Discover card counts it). The literal is compared with `TFv1DefaultConfig` by
-- `tf-v1-engine-copies.migration-parity.test.ts`; `scripts/lib/tf-v1-copies-probe.mjs` runs this
-- file again over seeded copies and deliberate values.

DO $$
DECLARE
  engine constant jsonb := '{"winBonus":3,"doublePenaltyFormula":"n*(n-1)/3","targetValues":{"deepTarget":2,"shallowTarget":1},"targets":[{"name":"Deep","value":2},{"name":"Shallow","value":1}],"matchFormat":{"pointCap":10,"scoringDirection":"normal","timerMode":"countdown","timeLimitsSeconds":{"pool":90,"bracket":90,"finals":90},"softClockLimitSeconds":5,"maxDoubleHits":4,"maxDoubleHitOutcome":"double_loss_zero_scores"}}'::jsonb; -- literal: tf_v1_engine_copies
  rows integer;
BEGIN
  SELECT count(*) INTO rows FROM public.custom_rulesets WHERE code = 'TF_v1' AND is_system;
  IF rows <> 1 THEN
    RAISE EXCEPTION '0245: % TF_v1 system rows, not 1', rows;
  END IF;

  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{winBonus}'
   WHERE code = 'TF_v1' AND is_system AND tf_config #> '{winBonus}' = engine #> '{winBonus}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{doublePenaltyFormula}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{doublePenaltyFormula}' = engine #> '{doublePenaltyFormula}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{targetValues}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{targetValues}' = engine #> '{targetValues}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{targets}'
   WHERE code = 'TF_v1' AND is_system AND tf_config #> '{targets}' = engine #> '{targets}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,pointCap}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,pointCap}' = engine #> '{matchFormat,pointCap}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,scoringDirection}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,scoringDirection}' = engine #> '{matchFormat,scoringDirection}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,timerMode}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,timerMode}' = engine #> '{matchFormat,timerMode}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,timeLimitsSeconds,pool}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,timeLimitsSeconds,pool}'
       = engine #> '{matchFormat,timeLimitsSeconds,pool}';
  UPDATE public.custom_rulesets
     SET tf_config = tf_config #- '{matchFormat,timeLimitsSeconds,bracket}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,timeLimitsSeconds,bracket}'
       = engine #> '{matchFormat,timeLimitsSeconds,bracket}';
  UPDATE public.custom_rulesets
     SET tf_config = tf_config #- '{matchFormat,timeLimitsSeconds,finals}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,timeLimitsSeconds,finals}'
       = engine #> '{matchFormat,timeLimitsSeconds,finals}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,softClockLimitSeconds}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,softClockLimitSeconds}'
       = engine #> '{matchFormat,softClockLimitSeconds}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,maxDoubleHits}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,maxDoubleHits}' = engine #> '{matchFormat,maxDoubleHits}';
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,maxDoubleHitOutcome}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,maxDoubleHitOutcome}'
       = engine #> '{matchFormat,maxDoubleHitOutcome}';

  -- A match format, or its time limits, left empty goes too.
  UPDATE public.custom_rulesets SET tf_config = tf_config #- '{matchFormat,timeLimitsSeconds}'
   WHERE code = 'TF_v1' AND is_system
     AND tf_config #> '{matchFormat,timeLimitsSeconds}' = '{}'::jsonb;
  UPDATE public.custom_rulesets SET tf_config = tf_config - 'matchFormat'
   WHERE code = 'TF_v1' AND is_system AND tf_config -> 'matchFormat' = '{}'::jsonb;

  IF EXISTS (
    SELECT 1
      FROM public.custom_rulesets r,
           unnest(ARRAY[
             '{winBonus}', '{doublePenaltyFormula}', '{targetValues}', '{targets}',
             '{matchFormat,pointCap}', '{matchFormat,scoringDirection}', '{matchFormat,timerMode}',
             '{matchFormat,timeLimitsSeconds,pool}', '{matchFormat,timeLimitsSeconds,bracket}',
             '{matchFormat,timeLimitsSeconds,finals}', '{matchFormat,softClockLimitSeconds}',
             '{matchFormat,maxDoubleHits}', '{matchFormat,maxDoubleHitOutcome}'
           ]::text[]) AS leaf
     WHERE r.code = 'TF_v1' AND r.is_system
       AND r.tf_config #> leaf::text[] = engine #> leaf::text[]
  ) THEN
    RAISE EXCEPTION '0245: TF_v1''s tf_config still holds a value equal to the engine''s';
  END IF;
END $$;
