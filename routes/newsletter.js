import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { addNewsletterContact } from '../lib/email.js';

export const newsletterRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

newsletterRouter.post('/signup', async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
  const email = rawEmail.trim().toLowerCase();

  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'Please provide a valid email address.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { error } = await supabase
    .from('email_signups')
    .insert({ email, source: 'homepage' });

  if (error && error.code !== '23505') {
    console.error('Newsletter signup insert error:', error);
    return res.status(500).json({ message: 'Could not save your signup.' });
  }

  const resendResult = await addNewsletterContact(email);
  if (!resendResult.ok && !resendResult.skipped) {
    console.warn('Resend newsletter contact sync failed:', resendResult.error);
  }

  return res.status(201).json({
    success: true,
    message: error?.code === '23505'
      ? 'This email is already subscribed.'
      : 'You are subscribed for updates.',
  });
});

newsletterRouter.get('/export', async (req, res) => {
  const token = process.env.NEWSLETTER_EXPORT_TOKEN;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const providedToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const expectedToken = token ? token.trim() : '';

  if (!expectedToken) {
    return res.status(503).json({ message: 'Export token is not configured.' });
  }
  if (bearerToken !== expectedToken && providedToken !== expectedToken) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { data, error } = await supabase
    .from('email_signups')
    .select('email, source, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Newsletter export read error:', error);
    return res.status(500).json({ message: 'Could not export email signups.' });
  }

  const rows = data || [];
  const format = String(req.query?.format || 'csv').toLowerCase();

  if (format === 'json') {
    return res.json({ count: rows.length, signups: rows });
  }

  const csv = [
    'email,source,created_at',
    ...rows.map((row) => [row.email, row.source || '', row.created_at || ''].map(escapeCsv).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="newsletter-signups.csv"');
  return res.status(200).send(csv);
});

function escapeCsv(value) {
  const input = String(value ?? '');
  if (!/[",\n]/.test(input)) return input;
  return `"${input.replace(/"/g, '""')}"`;
}
