-- 0082_registrations_fighter_id_consistency_audit.sql
--
-- Final consistency check before 0083 drops registrations.fighter_id.
-- On a fresh DB: zero rows, the DO block returns immediately.
-- On a snapshot restore: HALT the deploy if any row's fighter_id
-- disagrees with persons.global_person_id, so the operator can
-- reconcile before identity-flow swaps to the persons.global_person_id
-- path.

BEGIN;

DO $$
DECLARE
  bad_count INT;
BEGIN
  SELECT count(*) INTO bad_count
    FROM registrations r
    JOIN persons p ON p.id = r.person_id
   WHERE r.fighter_id IS DISTINCT FROM p.global_person_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'registrations.fighter_id mismatch on % rows. '
      'Reconcile (or null both columns) before 0083 drops fighter_id.',
      bad_count;
  END IF;
END $$;

COMMIT;
