import { Router } from 'express';
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

export const stripeRouter = Router();
export const stripeWebhookRouter = Router();

const ALLOWED_AMOUNTS = [5, 10, 15, 20];

/**
 * POST /api/stripe/create-checkout-session
 * Body: { amount: number } — one of 5, 10, 15, 20 (USD)
 * Returns: { url: string } — redirect to Stripe Checkout
 */
stripeRouter.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ message: 'Payments are not configured.' });
  }

  const amount = typeof req.body?.amount === 'number' ? req.body.amount : Number(req.body?.amount);
  if (!Number.isInteger(amount) || !ALLOWED_AMOUNTS.includes(amount)) {
    return res.status(400).json({
      message: 'Invalid amount. Allowed values: 5, 10, 15, 20.',
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'One-time support',
              description: 'Optional one-time support for Victoriacross.ca — research and site maintenance.',
              images: [],
            },
            unit_amount: amount * 100, // cents
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/support?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/support?canceled=1`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe create-checkout-session error:', err);
    res.status(500).json({ message: 'Failed to create checkout session.' });
  }
});

/**
 * POST /api/stripe/webhook
 * Raw body required for signature verification. Mount with express.raw().
 */
stripeWebhookRouter.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.warn('Stripe webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe webhook received:', event.type, event.id);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerName = session.customer_details?.name ?? null;
      const email = session.customer_email ?? session.customer_details?.email ?? null;
      const amountCents = session.amount_total ?? 0;
      const currency = (session.currency ?? 'usd').toLowerCase();

      if (!supabase) {
        console.warn('Stripe webhook: Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY). Payment not stored:', session.id);
        break;
      }

      const { data, error } = await supabase.from('payments').insert({
        stripe_session_id: session.id,
        customer_name: customerName,
        email: email || null,
        amount_cents: amountCents,
        currency,
      }).select('id').single();

      if (error) {
        console.error('Stripe webhook: failed to store payment in Supabase:', error.code, error.message, error.details);
        // Still return 200 so Stripe does not retry
      } else {
        console.log('Stripe webhook: payment stored in Supabase:', data?.id, 'session:', session.id);
      }
      break;
    }
    case 'checkout.session.expired':
      console.log('Checkout session expired:', event.data.object?.id);
      break;
    default:
      // Unhandled event type
      break;
  }

  res.send();
});
