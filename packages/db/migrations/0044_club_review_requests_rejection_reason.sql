-- 0044_club_review_requests_rejection_reason.sql
-- Adds rejection_reason to club_review_requests so the unified review-queue
-- reject dispatcher (mig 0043 / review-queue module) can persist a uniform
-- rejection_reason across all 4 request types.

ALTER TABLE club_review_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
