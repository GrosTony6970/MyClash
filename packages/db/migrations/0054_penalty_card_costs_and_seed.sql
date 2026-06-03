-- Migration 0054: per-card point costs + forfeit-scope + reliable inlined seed
-- for the FFAMHE built-in penalty ruleset.
--
-- Background:
--  - Card costs and forfeit scope were hardcoded in
--    `packages/rulesets/src/penalties/index.ts` (red=-1, yellow/black=0,
--    black always ends the match). Operators couldn't tune this per ruleset.
--  - The built-in FFAMHE row was previously seeded at runtime by
--    `ensureBuiltInRuleset` reading the CSV via existsSync against three
--    candidate paths. In production containers none of those candidates
--    usually resolve, the function logs a warning and the seed silently
--    fails — the admin UI shows an empty list. This migration inlines the
--    CSV contents so the seed lives in the migration chain and never
--    depends on filesystem layout at runtime.
--
-- The generator script that produced the entries VALUES block (and
-- computed the CSV SHA-256) is at scripts/gen-ffamhe-penalty-seed.ts.
-- Re-run it whenever the canonical CSV at
-- packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv changes.
--
-- Defaults preserve the prior runtime behavior exactly:
--   yellow_card_points = 0
--   red_card_points    = -1   (matches penaltyScoreDelta('red'))
--   black_card_points  = 0
--   first_black_card_forfeit  = 'match'       (current penaltyCausesMatchForfeit)
--   second_black_card_forfeit = 'tournament'  (matches DEFAULT_FORFEIT_POLICY
--                                              black_card_2.tournamentState=disqualified)

-- 1. Schema: add the configurable columns.
ALTER TABLE penalty_rulesets
  ADD COLUMN IF NOT EXISTS yellow_card_points INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS red_card_points    INT NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS black_card_points  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_black_card_forfeit  TEXT NOT NULL DEFAULT 'match'
    CHECK (first_black_card_forfeit  IN ('match','tournament','none')),
  ADD COLUMN IF NOT EXISTS second_black_card_forfeit TEXT NOT NULL DEFAULT 'tournament'
    CHECK (second_black_card_forfeit IN ('match','tournament','none'));

-- 2. Built-in FFAMHE row. Idempotent via the unique (code, version, owner)
--    constraint already enforced by 0016_penalties.sql. owner_organization_id
--    stays NULL — built-ins are platform-wide.
INSERT INTO penalty_rulesets (
  code, version, name, built_in, public_visibility, accumulation_scope,
  csv_source_name, csv_source_sha256,
  yellow_card_points, red_card_points, black_card_points,
  first_black_card_forfeit, second_black_card_forfeit
) VALUES (
  'ffamhe_tf_2026',
  '1.0.0',
  'Penalty - Tournois fédéraux FFAMHE',
  TRUE,
  TRUE,
  'match',
  'ffamhe_tf_2026.csv',
  '0a3a27432e71324cb0085a2bc1f6dd78dbb977269735f4f69736009bf613ab6e',
  0,
  -1,
  0,
  'match',
  'tournament'
)
ON CONFLICT (code, version, owner_organization_id) DO NOTHING;

-- 3. Replace entries idempotently. Delete then insert so re-running the
--    migration (or applying after a manual partial seed) leaves the
--    canonical list in place.
DELETE FROM penalty_ruleset_entries
WHERE ruleset_id = (
  SELECT id FROM penalty_rulesets
  WHERE code = 'ffamhe_tf_2026'
    AND version = '1.0.0'
    AND owner_organization_id IS NULL
);

INSERT INTO penalty_ruleset_entries (
  ruleset_id, group_number, ref_number, short_name, description, sanctions, sort_order
)
SELECT
  r.ruleset_id,
  v.group_number,
  v.ref_number,
  v.short_name,
  v.description,
  v.sanctions,
  v.sort_order
FROM (VALUES
  (1, 1, 'Sortie de Lice', 'Sortir involontairement la zone de combat, que ce soit par soi-même ou sous la pression de l''adversaire.', '["yellow","red","red","red"]'::jsonb, 1),
  (2, 2, 'Non-prêt', 'Ne pas être prêt au début du match et/ou venue', '["yellow","red","red","red"]'::jsonb, 2),
  (2, 3, 'Parler à haute voix', 'Parler à haute voix à plusieurs reprises durant un match', '["yellow","red","red","red"]'::jsonb, 3),
  (2, 4, 'Frappe au sol', 'Frapper le sol avec sa lame', '["yellow","red","red","red"]'::jsonb, 4),
  (2, 5, 'Cri en assaut', 'Crier durant l’assaut', '["yellow","red","red","red"]'::jsonb, 5),
  (3, 6, 'Non-combativité', 'Non-combativité (absence d’action offensive et/ou de pressurisation pendant 10 secondes consécutives).', '["yellow","red","red","black"]'::jsonb, 6),
  (3, 7, 'Déplacement anormal', 'Déplacements anormaux (bonds, squats, roulades, glissades etc.)', '["yellow","red","red","black"]'::jsonb, 7),
  (3, 8, 'Contestation abusive', 'Contester de façon non courtoise et/ou répétitive l’arbitrage', '["yellow","red","red","black"]'::jsonb, 8),
  (3, 9, 'Non respect halte', 'Continuer le combat après le « halte »', '["yellow","red","red","black"]'::jsonb, 9),
  (3, 10, 'Force excessive', 'Frapper avec une force excessive son adversaire', '["yellow","red","red","black"]'::jsonb, 10),
  (3, 11, 'Touche interdite invol.', 'Frapper involontairement avec son arme une zone interdite. (action engagée avant ou au moment de la présentation de la zone)', '["yellow","red","red","black"]'::jsonb, 11),
  (3, 12, 'Présentation interdite invol.', 'Présenter involontairement une zone interdite ou invalide à son adversaire', '["yellow","red","red","black"]'::jsonb, 12),
  (3, 13, 'Substitution invol.', 'Substituer involontairement une zone valide par une zone interdite ou invalide', '["yellow","red","red","black"]'::jsonb, 13),
  (3, 14, 'Coach en zone', 'Présence du coach dans la zone de combat', '["yellow","red","red","black"]'::jsonb, 14),
  (3, 15, 'Matériel non conforme', 'Matériel non conforme au règlement', '["yellow","red","red","black"]'::jsonb, 15),
  (4, 16, 'Geste interdit', 'Effectuer un geste interdit', '["red","red","black","black"]'::jsonb, 16),
  (4, 17, 'Présentation zone interdite vol.', 'Présenter volontairement une zone interdite ou invalide à son adversaire', '["red","red","black","black"]'::jsonb, 17),
  (4, 18, 'Substitution vol.', 'Substituer volontairement une zone valide par une zone interdite ou invalide', '["red","red","black","black"]'::jsonb, 18),
  (5, 19, 'Sortie vol.', 'Sortir volontairement de la zone de combat (Dans un but manifeste d''antijeu, ou de mettre fin à l''échange)', '["black","black","black","black"]'::jsonb, 19),
  (5, 20, 'Touche interdite vol.', 'Frapper volontairement une zone interdite', '["black","black","black","black"]'::jsonb, 20),
  (5, 21, 'Geste dangereux', 'Réaliser un geste dangereux', '["black","black","black","black"]'::jsonb, 21),
  (5, 22, 'Brutalité vol.', 'Brutalité intentionnelle', '["black","black","black","black"]'::jsonb, 22),
  (5, 23, 'Refus de salut', 'Refuser de saluer l’adversaire ou le corps arbitral', '["black","black","black","black"]'::jsonb, 23),
  (5, 24, 'Refus de combat', 'Refuser de rencontrer un adversaire', '["black","black","black","black"]'::jsonb, 24),
  (5, 25, 'Insulte', 'Insulter un adversaire, un officiel ou un coach', '["black","black","black","black"]'::jsonb, 25),
  (5, 26, 'Blessure volontaire', 'Blesser volontairement un adversaire', '["black","black","black","black"]'::jsonb, 26),
  (5, 27, 'Combat truqué', 'Être en situation de combat truqué avéré', '["black","black","black","black"]'::jsonb, 27),
  (5, 28, 'Fraude matériel', 'Matériel non conforme au règlement par fraude manifeste', '["black","black","black","black"]'::jsonb, 28)
) AS v(group_number, ref_number, short_name, description, sanctions, sort_order)
CROSS JOIN (
  SELECT id AS ruleset_id FROM penalty_rulesets
  WHERE code = 'ffamhe_tf_2026'
    AND version = '1.0.0'
    AND owner_organization_id IS NULL
) r;
