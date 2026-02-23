-- Fix petition_signatures check constraint so waterman-vc and waterman-dso are allowed.
-- Run this in Supabase Dashboard → SQL Editor if you see:
--   new row for relation "petition_signatures" violates check constraint "petition_signatures_petition_id_check"

ALTER TABLE petition_signatures
  DROP CONSTRAINT IF EXISTS petition_signatures_petition_id_check;

ALTER TABLE petition_signatures
  ADD CONSTRAINT petition_signatures_petition_id_check
  CHECK (petition_id IN ('waterman-vc', 'waterman-dso', 'hickey'));
