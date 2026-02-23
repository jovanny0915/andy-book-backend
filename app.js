import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { petitionsRouter } from './routes/petitions.js';
import { forumRouter } from './routes/forum.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';
import { stripeRouter, stripeWebhookRouter } from './routes/stripe.js';

const app = express();

// Allow multiple origins: set FRONTEND_ORIGIN to one URL, or ALLOWED_ORIGINS to comma-separated list
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [process.env.FRONTEND_ORIGIN || 'http://localhost:3000', 'https://andy-book-frontend.vercel.app', 'https://victoriacross.ca'].filter(Boolean);
const uniqueOrigins = [...new Set(allowedOrigins)];

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // same-origin or server-to-server
    if (uniqueOrigins.includes(origin)) return callback(null, true);
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
app.use('/api/admin', adminRouter);
app.use('/api/stripe', stripeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
