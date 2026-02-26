import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuthMiddleware } from '../lib/adminAuth.js';

export const adminRouter = Router();

// All admin routes require valid admin auth
adminRouter.use(adminAuthMiddleware);

// ---- Sales reporting (Stripe-backed payments) ----
adminRouter.get('/sales/summary', async (req, res) => {
  if (!supabase) {
    return res.json({
      currency: 'usd',
      totals: {
        overall_cents: 0,
        with_code_cents: 0,
        without_code_cents: 0,
        discounts_given_cents: 0,
      },
      counts: {
        overall: 0,
        with_code: 0,
        without_code: 0,
      },
    });
  }

  const { data, error } = await supabase
    .from('payments')
    .select('amount_cents, original_amount_cents, discount_amount_cents, used_discount_code, currency');

  if (error) {
    console.error('Admin sales summary error:', error);
    return res.status(500).json({ message: 'Failed to load sales summary.' });
  }

  const summary = (data || []).reduce((acc, payment) => {
    const amount = Number(payment.amount_cents || 0);
    const discountAmount = Number(payment.discount_amount_cents || 0);
    const usedCode = Boolean(payment.used_discount_code);

    acc.overall_cents += amount;
    acc.discounts_given_cents += discountAmount;
    acc.overall += 1;

    if (usedCode) {
      acc.with_code_cents += amount;
      acc.with_code += 1;
    } else {
      acc.without_code_cents += amount;
      acc.without_code += 1;
    }
    return acc;
  }, {
    overall_cents: 0,
    with_code_cents: 0,
    without_code_cents: 0,
    discounts_given_cents: 0,
    overall: 0,
    with_code: 0,
    without_code: 0,
  });

  return res.json({
    currency: 'usd',
    totals: {
      overall_cents: summary.overall_cents,
      with_code_cents: summary.with_code_cents,
      without_code_cents: summary.without_code_cents,
      discounts_given_cents: summary.discounts_given_cents,
    },
    counts: {
      overall: summary.overall,
      with_code: summary.with_code,
      without_code: summary.without_code,
    },
  });
});

// GET /api/admin/me – return current admin user (for frontend auth check)
adminRouter.get('/me', (req, res) => {
  res.json({ user: req.adminUser });
});

// ---- Admin users (admin_users table) ----

// GET /api/admin/admins – list admin users (who can access /admin)
adminRouter.get('/admins', async (req, res) => {
  if (!supabase) {
    return res.json({ admins: [] });
  }
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, email, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Admin list admins error:', error);
    return res.status(500).json({ message: 'Failed to list admins.' });
  }
  res.json({ admins: data || [] });
});

// POST /api/admin/admins – add admin by email (user must already exist in Supabase Auth with password)
adminRouter.post('/admins', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    return res.status(400).json({ message: 'Body must include email.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }
  const { data, error } = await supabase
    .from('admin_users')
    .insert({ email })
    .select('id, email, created_at')
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'This email is already an admin.' });
    }
    console.error('Admin add admin error:', error);
    return res.status(500).json({ message: 'Failed to add admin.' });
  }
  res.status(201).json(data);
});

// DELETE /api/admin/admins/:id – remove admin (by admin_users.id)
adminRouter.delete('/admins/:id', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }
  const { data, error } = await supabase
    .from('admin_users')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Admin remove admin error:', error);
    return res.status(500).json({ message: 'Failed to remove admin.' });
  }
  if (!data) {
    return res.status(404).json({ message: 'Admin not found.' });
  }
  res.json({ message: 'Admin removed.' });
});

// ---- Pending posts (forum) ----

// GET /api/admin/posts/pending – list pending forum threads and replies
adminRouter.get('/posts/pending', async (req, res) => {
  if (!supabase) {
    return res.json({ threads: [], replies: [] });
  }

  const [threadsRes, repliesRes] = await Promise.all([
    supabase
      .from('forum_threads')
      .select('id, title, body, author_email, category, created_at, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('forum_replies')
      .select('id, thread_id, body, author_email, created_at, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ]);

  const threads = threadsRes.error ? [] : threadsRes.data || [];
  const replies = repliesRes.error ? [] : repliesRes.data || [];

  res.json({ threads, replies });
});

// PATCH /api/admin/posts/threads/:id – approve or reject a thread
adminRouter.patch('/posts/threads/:id', async (req, res) => {
  const status = req.body?.status;
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ message: 'Body must include status: "approved" or "rejected".' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  const { data, error } = await supabase
    .from('forum_threads')
    .update({ status })
    .eq('id', req.params.id)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('Admin update thread error:', error);
    return res.status(500).json({ message: 'Failed to update thread.' });
  }
  if (!data) {
    return res.status(404).json({ message: 'Thread not found.' });
  }
  res.json(data);
});

// PATCH /api/admin/posts/replies/:id – approve or reject a reply
adminRouter.patch('/posts/replies/:id', async (req, res) => {
  const status = req.body?.status;
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ message: 'Body must include status: "approved" or "rejected".' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  const { data, error } = await supabase
    .from('forum_replies')
    .update({ status })
    .eq('id', req.params.id)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('Admin update reply error:', error);
    return res.status(500).json({ message: 'Failed to update reply.' });
  }
  if (!data) {
    return res.status(404).json({ message: 'Reply not found.' });
  }
  res.json(data);
});

// ---- User management (Supabase Auth) ----

// GET /api/admin/users – list auth users (paginated)
adminRouter.get('/users', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 50));

  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage,
  });

  if (error) {
    console.error('Admin list users error:', error);
    return res.status(500).json({ message: 'Failed to list users.' });
  }

  const users = (data?.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    banned_until: u.banned_until ?? null,
  }));

  res.json({
    users,
    total: data?.total ?? users.length,
    page: data?.nextPage ? page : page,
    per_page: perPage,
  });
});

// POST /api/admin/users/:id/ban – ban a user (indefinite if no body, or pass unban)
adminRouter.post('/users/:id/ban', async (req, res) => {
  const userId = req.params.id;
  if (!userId) {
    return res.status(400).json({ message: 'User ID required.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  // { ban: false } to unban, otherwise ban (use long duration for "indefinite")
  const ban = req.body?.ban !== false;
  const attributes = ban
    ? { ban_duration: '876600h' } // ~100 years
    : { ban_duration: 'none' };

  const { data, error } = await supabase.auth.admin.updateUserById(userId, attributes);

  if (error) {
    console.error('Admin ban user error:', error);
    return res.status(500).json({ message: error.message || 'Failed to update user.' });
  }
  res.json({
    message: ban ? 'User banned.' : 'User unbanned.',
    user: data?.user
      ? {
          id: data.user.id,
          email: data.user.email,
          banned_until: data.user.banned_until ?? null,
        }
      : null,
  });
});

// POST /api/admin/users/reset-password – generate recovery link for an email
adminRouter.post('/users/reset-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    return res.status(400).json({ message: 'Body must include email.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  const siteUrl = process.env.SITE_URL || 'https://victoriacross.ca';

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${siteUrl}/admin` },
  });

  if (error) {
    console.error('Admin generate recovery link error:', error);
    return res.status(500).json({ message: error.message || 'Failed to generate link.' });
  }

  res.json({
    message: 'Recovery link generated. Send it to the user securely.',
    email,
    action_link: data?.properties?.action_link ?? null,
  });
});
