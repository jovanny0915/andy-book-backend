import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

export const reviewsRouter = Router();

const MAX_TITLE = 120;
const MAX_NAME = 80;
const MAX_QUOTE = 1200;

function parseRating(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseConsent(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function reviewInsertErrorMessage(error) {
  const code = error?.code;
  const msg = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205' || /relation.*does not exist|table.*does not exist/i.test(msg)) {
    return {
      status: 500,
      message:
        'Could not save your review. The reviews table may be missing or out of date. Apply backend/supabase/schema.sql (and book_reviews_rename_quote_to_review_text.sql if upgrading).',
    };
  }
  if (code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(msg)) {
    return {
      status: 503,
      message: 'Could not save your review. Server database access is misconfigured. Check SUPABASE_SERVICE_ROLE_KEY on the API host.',
    };
  }
  if (code === '23514' || code === '23502') {
    return { status: 400, message: 'Review could not be saved due to invalid data. Please check your fields and try again.' };
  }
  return { status: 500, message: 'Could not submit review.' };
}

// GET /api/reviews - approved public reviews
reviewsRouter.get('/', async (_req, res) => {
  if (!supabase) {
    return res.json({ reviews: [] });
  }

  try {
    let data;
    let error;
    ({ data, error } = await supabase
      .from('book_reviews')
      .select('id, title, rating, review_text, reviewer_name, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(20));

    if (
      error &&
      /review_text|42703|PGRST204|column|does not exist|Could not find the .* column/i.test(
        String(error.message || '') + String(error.code || ''),
      )
    ) {
      ({ data, error } = await supabase
        .from('book_reviews')
        .select('id, title, rating, quote, reviewer_name, created_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20));
    }

    if (error) {
      console.error('Reviews list error:', error);
      return res.json({ reviews: [] });
    }

    const reviews = (data || []).map((row) => ({
      id: row.id,
      title: row.title,
      rating: row.rating,
      quote: row.review_text ?? row.quote,
      reviewerName: row.reviewer_name,
      createdAt: row.created_at,
    }));

    return res.json({ reviews });
  } catch (err) {
    console.error('Reviews list exception:', err);
    return res.json({ reviews: [] });
  }
});

// POST /api/reviews - submit review (JSON uses "quote" for the body text; stored as review_text)
reviewsRouter.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const quote = typeof body.quote === 'string' ? body.quote.trim() : '';
    const reviewerName = typeof body.reviewerName === 'string' ? body.reviewerName.trim() : '';
    const rating = parseRating(body.rating);
    const consent = parseConsent(body.consent);

    if (!title || !quote || !reviewerName || !Number.isInteger(rating) || rating < 1 || rating > 5 || !consent) {
      return res.status(400).json({ message: 'Please provide title, name, quote, rating (1-5), and consent.' });
    }
    if (title.length > MAX_TITLE || reviewerName.length > MAX_NAME || quote.length > MAX_QUOTE) {
      return res.status(400).json({ message: 'Review is too long. Please shorten and try again.' });
    }
    if (!supabase) {
      return res.status(503).json({ message: 'Service temporarily unavailable.' });
    }

    // Omit consent_given when inserting so older `book_reviews` schemas without that column still work;
    // current schema defaults consent_given to true (see supabase/schema.sql).
    const rowPreferred = {
      title,
      review_text: quote,
      reviewer_name: reviewerName,
      rating,
      status: 'approved',
    };
    const rowLegacy = {
      title,
      quote,
      reviewer_name: reviewerName,
      rating,
      status: 'approved',
    };

    let insertError;
    ({ error: insertError } = await supabase.from('book_reviews').insert(rowPreferred));
    const errText = String(insertError?.message || '') + String(insertError?.code || '');
    if (
      insertError &&
      (/review_text|42703|PGRST204|column .* does not exist|Could not find the .* column/i.test(errText))
    ) {
      ({ error: insertError } = await supabase.from('book_reviews').insert(rowLegacy));
    }

    if (insertError) {
      console.error('Review insert error:', insertError);
      const mapped = reviewInsertErrorMessage(insertError);
      return res.status(mapped.status).json({ message: mapped.message });
    }

    return res.status(201).json({
      success: true,
      message: 'Thank you. Your review has been published.',
    });
  } catch (err) {
    console.error('Review submit exception:', err);
    return res.status(500).json({ message: 'Could not submit review.' });
  }
});
