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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
