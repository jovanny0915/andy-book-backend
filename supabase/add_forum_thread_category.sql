-- Run this in Supabase Dashboard → SQL Editor so that forum post category is stored.
-- If forum_threads was created before the category column existed, this adds it.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

-- Backfill existing rows that might have NULL (only if column was added without DEFAULT in the past)
UPDATE forum_threads SET category = 'general' WHERE category IS NULL;
