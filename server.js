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
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000' }));
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

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
