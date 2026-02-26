-- Run this in Supabase Dashboard → SQL Editor to create tables for Victoriacross.ca

-- Petition signatures: one row per signer per petition. Count only verified.
CREATE TABLE IF NOT EXISTS petition_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  petition_id TEXT NOT NULL CHECK (petition_id IN ('waterman-vc', 'waterman-dso', 'hickey')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT true,
  verification_token TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One signer per petition (case-insensitive email)
CREATE UNIQUE INDEX idx_petition_signatures_petition_email_lower
  ON petition_signatures (petition_id, LOWER(email));

CREATE INDEX IF NOT EXISTS idx_petition_signatures_petition_verified
  ON petition_signatures (petition_id) WHERE verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_petition_signatures_token
  ON petition_signatures (verification_token) WHERE verification_token IS NOT NULL;

-- Forum: users (email-only, verified via link)
CREATE TABLE IF NOT EXISTS forum_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  verification_token TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forum_users_token
  ON forum_users (verification_token) WHERE verification_token IS NOT NULL;

-- Forum threads (approved/pending for moderation)
CREATE TABLE IF NOT EXISTS forum_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_email TEXT NOT NULL REFERENCES forum_users(email),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'waterman', 'hickey', 'wilmot')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add category column if table already existed without it (run once if needed)
-- ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_forum_threads_status ON forum_threads (status);

-- Forum replies
CREATE TABLE IF NOT EXISTS forum_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL REFERENCES forum_users(email),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies (thread_id);

-- Book reviews: user-submitted ratings shown on /book after moderation approval.
CREATE TABLE IF NOT EXISTS book_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  quote TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  consent_given BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_reviews_status_created_at
  ON book_reviews (status, created_at DESC);

-- Optional: allow petition_signatures without requiring forum_users
-- Forum users are separate (email verification for forum only).

-- Admin users: who can access /admin (must sign in with Supabase Auth email+password).
-- Add an email here after the user has signed up (or been invited) in Supabase Auth.
-- First admin: create auth user in Supabase Dashboard, then: INSERT INTO admin_users (email) VALUES ('your@email.com');
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower ON admin_users (LOWER(email));

-- Payments: one-time donations from Stripe Checkout (filled by webhook on checkout.session.completed)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  email TEXT,
  amount_cents INTEGER NOT NULL,
  original_amount_cents INTEGER NOT NULL,
  discount_amount_cents INTEGER NOT NULL DEFAULT 0,
  discount_code TEXT,
  used_discount_code BOOLEAN NOT NULL DEFAULT false,
  payment_type TEXT NOT NULL DEFAULT 'support' CHECK (payment_type IN ('support', 'book')),
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill-safe updates for existing tables created before discount fields were added.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount_cents INTEGER;
UPDATE payments SET original_amount_cents = amount_cents WHERE original_amount_cents IS NULL;
ALTER TABLE payments ALTER COLUMN original_amount_cents SET NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS used_discount_code BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'support';
UPDATE payments SET payment_type = 'support' WHERE payment_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_used_discount_code ON payments (used_discount_code);
CREATE INDEX IF NOT EXISTS idx_payments_payment_type ON payments (payment_type);
