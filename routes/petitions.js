import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { sendPetitionVerification } from '../lib/email.js';
import { generateToken } from '../lib/tokens.js';

export const petitionsRouter = Router();

const VALID_IDS = ['waterman-vc', 'waterman-dso', 'hickey'];
// Homepage / legacy count alias: 'waterman' -> waterman-vc
const COUNT_ALIAS = { waterman: 'waterman-vc' };

// POST /api/petitions/sign – add signature and send verification email
petitionsRouter.post('/sign', async (req, res) => {
  const body = req.body || {};
  const { petitionId, name, email, country, consent } = body;
  if (body.website) {
    return res.status(400).json({ message: 'Invalid submission.' });
  }
  if (!petitionId || !name || !email || !country || consent !== true) {
    return res.status(400).json({ message: 'Missing or invalid fields. Consent required.' });
  }
  if (!VALID_IDS.includes(petitionId)) {
    return res.status(400).json({ message: 'Invalid petition.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const verificationToken = generateToken();
  const emailNormalized = String(email).trim().toLowerCase();
  // DB enforces one signer per (petition_id, LOWER(email)) via unique index
  const { data: existing } = await supabase
    .from('petition_signatures')
    .select('id')
    .eq('petition_id', petitionId)
    .ilike('email', emailNormalized)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ message: 'This email has already been used to vote for this petition.' });
  }

  const { error: insertError } = await supabase.from('petition_signatures').insert({
    petition_id: petitionId,
    name: String(name).trim(),
    email: emailNormalized,
    country: String(country).trim(),
    consent_given: true,
    verification_token: verificationToken,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(400).json({ message: 'This email has already been used to vote for this petition.' });
    }
    console.error('Petition sign insert error:', insertError);
    return res.status(500).json({ message: 'Could not save signature.' });
  }

  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const verifyUrl = `${siteUrl}/verify-petition?token=${encodeURIComponent(verificationToken)}`;
  const { ok } = await sendPetitionVerification(email, name, petitionId, verificationToken);

  res.status(201).json({
    success: true,
    message: ok
      ? 'Verification email sent. Please check your inbox.'
      : 'Verification link created. In development, use the link below to verify.',
    ...(ok ? {} : { verificationUrl: verifyUrl }),
  });
});

// GET /api/petitions/:id/count – public live counter (verified only)
petitionsRouter.get('/:id/count', async (req, res) => {
  let id = req.params.id;
  if (COUNT_ALIAS[id]) id = COUNT_ALIAS[id];
  if (!VALID_IDS.includes(id)) {
    return res.status(404).json({ message: 'Not found.' });
  }
  if (!supabase) {
    return res.json({ count: 0 });
  }
  const { count, error } = await supabase
    .from('petition_signatures')
    .select('*', { count: 'exact', head: true })
    .eq('petition_id', id)
    .not('verified_at', 'is', null);
  if (error) {
    console.error('Count error:', error);
    return res.json({ count: 0 });
  }
  res.json({ count: count ?? 0 });
});

// POST /api/petitions/verify – verify email (token from email link)
petitionsRouter.post('/verify', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ message: 'Token required.' });
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { data: row, error: findError } = await supabase
    .from('petition_signatures')
    .select('id, petition_id, verified_at')
    .eq('verification_token', token)
    .maybeSingle();

  if (findError || !row) {
    return res.status(400).json({ message: 'Invalid or expired link.' });
  }
  if (row.verified_at) {
    return res.json({ verified: true, message: 'Already verified.' });
  }

  const { error: updateError } = await supabase
    .from('petition_signatures')
    .update({ verified_at: new Date().toISOString(), verification_token: null })
    .eq('id', row.id);

  if (updateError) {
    console.error('Verify update error:', updateError);
    return res.status(500).json({ message: 'Verification failed.' });
  }

  res.json({ verified: true, petitionId: row.petition_id, message: 'Your vote has been verified. Thank you.' });
});
