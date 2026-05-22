-- Migration 0045: align pool assignment settings with scheduling/referee services

ALTER TABLE pool_assignment_settings
  ADD COLUMN IF NOT EXISTS workshop_conflict_warning BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS rating_based_ordering BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS workload_balance BOOLEAN NOT NULL DEFAULT TRUE;
