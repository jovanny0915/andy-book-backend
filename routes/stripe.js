import { Router } from 'express';
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const siteUrl = process.env.SITE_URL || 'https://victoriacross.ca';

export const stripeRouter = Router();
export const stripeWebhookRouter = Router();

const SUPPORT_AMOUNTS = [5, 10, 15, 20];
const DISCOUNT_PERCENT = 20;
const HANDOUT_DISCOUNT_CODES = [
  'VCROSS20A',
  'VCROSS20B',
  'VCROSS20C',
  'VCROSS20D',
  'VCROSS20E',
];
const BOOK_PRICE_CENTS = Number.parseInt(process.env.BOOK_PRICE_CENTS ?? '2499', 10);
const BOOK_CURRENCY = (process.env.BOOK_CURRENCY || 'usd').toLowerCase();
const BOOK_PRODUCT_NAME = process.env.BOOK_PRODUCT_NAME || "The Chaplain's Diary";

function normalizePaymentType(value) {
  return value === 'book' ? 'book' : 'support';
}

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * POST /api/stripe/validate-discount-code
 * Body: { discountCode?: string }
 * Returns: { valid: boolean, message?: string }
 */
stripeRouter.post('/validate-discount-code', (req, res) => {
  const discountCode = normalizeCode(req.body?.discountCode);
  if (!discountCode) {
    return res.status(200).json({ valid: true });
  }
  const valid = HANDOUT_DISCOUNT_CODES.includes(discountCode);
  if (!valid) {
    return res.status(400).json({ valid: false, message: 'Invalid discount code.' });
  }
  return res.status(200).json({ valid: true });
});

/**
 * POST /api/stripe/create-checkout-session
 * Body:
 *  - Support: { paymentType?: 'support', amount: number, discountCode?: string } — one of 5, 10, 15, 20 (USD)
 *  - Book: { paymentType: 'book', discountCode?: string } — fixed amount from BOOK_PRICE_CENTS (USD by default)
 * Returns: { url: string } — redirect to Stripe Checkout
 */
stripeRouter.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ message: 'Payments are not configured.' });
  }

  const paymentType = normalizePaymentType(req.body?.paymentType);
  const isBookCheckout = paymentType === 'book';

  let originalAmountCents;
  let currency;
  let productName;
  let productDescription;

  if (isBookCheckout) {
    if (!Number.isInteger(BOOK_PRICE_CENTS) || BOOK_PRICE_CENTS <= 0) {
      return res.status(500).json({ message: 'Book checkout is not configured correctly.' });
    }
    originalAmountCents = BOOK_PRICE_CENTS;
    currency = BOOK_CURRENCY;
    productName = BOOK_PRODUCT_NAME;
    productDescription = 'Direct purchase of The Chaplain\'s Diary.';
  } else {
    const amount = typeof req.body?.amount === 'number' ? req.body.amount : Number(req.body?.amount);
    if (!Number.isInteger(amount) || !SUPPORT_AMOUNTS.includes(amount)) {
      return res.status(400).json({
        message: 'Invalid amount. Allowed values: 5, 10, 15, 20.',
      });
    }
    originalAmountCents = amount * 100;
    currency = 'usd';
    productName = 'One-time support';
    productDescription = 'Optional one-time support for Victoriacross.ca — research and site maintenance.';
  }

  const discountCode = normalizeCode(req.body?.discountCode);
  const wantsDiscount = discountCode.length > 0;
  const validDiscountCode = wantsDiscount && HANDOUT_DISCOUNT_CODES.includes(discountCode);

  if (wantsDiscount && !validDiscountCode) {
    return res.status(400).json({ message: 'Invalid discount code.' });
  }

  const finalAmountCents = validDiscountCode
    ? Math.round(originalAmountCents * (100 - DISCOUNT_PERCENT) / 100)
    : originalAmountCents;
  const discountAmountCents = originalAmountCents - finalAmountCents;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      metadata: {
        payment_type: paymentType,
        discount_code: validDiscountCode ? discountCode : '',
        used_discount_code: validDiscountCode ? 'true' : 'false',
        original_amount_cents: String(originalAmountCents),
        discount_amount_cents: String(discountAmountCents),
      },
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: productName,
              description: productDescription,
              images: [],
            },
            unit_amount: finalAmountCents, // cents
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/${isBookCheckout ? 'book' : 'support'}?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/${isBookCheckout ? 'book' : 'support'}?canceled=1`,
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
      const paymentType = normalizePaymentType(session.metadata?.payment_type);
      const discountCode = normalizeCode(session.metadata?.discount_code);
      const usedDiscountCode = session.metadata?.used_discount_code === 'true' || !!discountCode;
      const parsedOriginalAmount = Number.parseInt(session.metadata?.original_amount_cents ?? '', 10);
      const parsedDiscountAmount = Number.parseInt(session.metadata?.discount_amount_cents ?? '', 10);
      const originalAmountCents = Number.isInteger(parsedOriginalAmount) && parsedOriginalAmount >= amountCents
        ? parsedOriginalAmount
        : amountCents;
      const discountAmountCents = Number.isInteger(parsedDiscountAmount) && parsedDiscountAmount >= 0
        ? parsedDiscountAmount
        : Math.max(originalAmountCents - amountCents, 0);

      if (!supabase) {
        console.warn('Stripe webhook: Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY). Payment not stored:', session.id);
        break;
      }

      const { data, error } = await supabase.from('payments').insert({
        stripe_session_id: session.id,
        customer_name: customerName,
        email: email || null,
        amount_cents: amountCents,
        original_amount_cents: originalAmountCents,
        discount_amount_cents: discountAmountCents,
        discount_code: usedDiscountCode ? discountCode : null,
        used_discount_code: usedDiscountCode,
        payment_type: paymentType,
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
