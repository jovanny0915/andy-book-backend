import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { petitionsRouter } from './routes/petitions.js';
import { forumRouter } from './routes/forum.js';
import { reviewsRouter } from './routes/reviews.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';
import { stripeRouter, stripeWebhookRouter } from './routes/stripe.js';

const app = express();

// Allow multiple origins: set FRONTEND_ORIGIN to one URL, or ALLOWED_ORIGINS to comma-separated list
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [
      process.env.FRONTEND_ORIGIN || 'https://victoriacross.ca',
      process.env.SITE_URL,
      'https://andy-book-frontend.vercel.app',
      'https://victoriacross.ca',
      'https://www.victoriacross.ca',
    ].filter(Boolean);

function normalizeOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return String(value || '').trim().replace(/\/+$/, '');
  }
}

const uniqueOrigins = [...new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean))];

function isAllowedPreviewOrigin(origin) {
  // Allow Vercel preview URLs for this frontend project.
  return /^https:\/\/andy-book-frontend-[a-z0-9-]+\.vercel\.app$/i.test(origin);
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // same-origin or server-to-server
    const normalized = normalizeOrigin(origin);
    if (uniqueOrigins.includes(normalized) || isAllowedPreviewOrigin(normalized)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));
app.use(morgan('dev'));

// Stripe webhook needs raw body for signature verification (must be before express.json)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/petitions', petitionsRouter);
app.use('/api/forum', forumRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/stripe', stripeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
