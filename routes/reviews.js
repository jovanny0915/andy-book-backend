import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

export const reviewsRouter = Router();

const MAX_TITLE = 120;
const MAX_NAME = 80;
const MAX_QUOTE = 1200;

// GET /api/reviews - approved public reviews
reviewsRouter.get('/', async (_req, res) => {
  if (!supabase) {
    return res.json({ reviews: [] });
  }

  const { data, error } = await supabase
    .from('book_reviews')
    .select('id, title, rating, quote, reviewer_name, created_at')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Reviews list error:', error);
    return res.json({ reviews: [] });
  }

  const reviews = (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    rating: row.rating,
    quote: row.quote,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
  }));

  return res.json({ reviews });
});

// POST /api/reviews - submit review
reviewsRouter.post('/', async (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const quote = typeof body.quote === 'string' ? body.quote.trim() : '';
  const reviewerName = typeof body.reviewerName === 'string' ? body.reviewerName.trim() : '';
  const rating = Number(body.rating);
  const consent = body.consent === true;

  if (!title || !quote || !reviewerName || !Number.isInteger(rating) || rating < 1 || rating > 5 || !consent) {
    return res.status(400).json({ message: 'Please provide title, name, quote, rating (1-5), and consent.' });
  }
  if (title.length > MAX_TITLE || reviewerName.length > MAX_NAME || quote.length > MAX_QUOTE) {
    return res.status(400).json({ message: 'Review is too long. Please shorten and try again.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { error } = await supabase.from('book_reviews').insert({
    title,
    quote,
    reviewer_name: reviewerName,
    rating,
    consent_given: true,
    status: 'approved',
  });

  if (error) {
    console.error('Review insert error:', error);
    if (error.code === '42P01') {
      return res.status(500).json({
        message: 'Could not submit review. Database may be missing "book_reviews" table. Run backend/supabase/schema.sql.',
      });
    }
    return res.status(500).json({ message: 'Could not submit review.' });
  }

  return res.status(201).json({
    success: true,
    message: 'Thank you. Your review has been published.',
  });
});
