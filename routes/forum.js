import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { sendForumVerification } from '../lib/email.js';
import { generateToken } from '../lib/tokens.js';
import { signForumToken, forumAuthMiddleware } from '../lib/forumAuth.js';

export const forumRouter = Router();

const ALLOWED_CATEGORIES = ['general', 'waterman', 'hickey', 'wilmot'];

// GET /api/forum/threads – list all threads, optional ?category= filter
forumRouter.get('/threads', async (req, res) => {
  if (!supabase) {
    return res.json({ threads: [] });
  }
  const rawCategory = req.query.category;
  const category =
    typeof rawCategory === 'string' && ALLOWED_CATEGORIES.includes(rawCategory.trim().toLowerCase())
      ? rawCategory.trim().toLowerCase()
      : null;

  let query = supabase
    .from('forum_threads')
    .select('id, title, author_email, created_at, category, status')
    .order('created_at', { ascending: false });

  if (category) {
    if (category === 'general') {
      // Show threads with category 'general' or null/undefined (legacy rows)
      query = query.or('category.eq.general,category.is.null');
    } else {
      query = query.eq('category', category);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('Forum threads list error:', error);
    return res.json({ threads: [] });
  }
  // Reply counts (approved only, for display consistency with thread page)
  const threadIds = (data || []).map((t) => t.id);
  const countByThread = {};
  if (threadIds.length > 0) {
    const { data: replies } = await supabase
      .from('forum_replies')
      .select('thread_id')
      .eq('status', 'approved')
      .in('thread_id', threadIds);
    (replies || []).forEach((r) => {
      countByThread[r.thread_id] = (countByThread[r.thread_id] || 0) + 1;
    });
  }
  // Normalize so every thread has a category and reply_count
  const threads = (data || []).map((t) => ({
    ...t,
    category: t.category || 'general',
    reply_count: countByThread[t.id] || 0,
  }));
  res.json({ threads });
});

// POST /api/forum/register – register with email (send verification)
forumRouter.post('/register', async (req, res) => {
  const { email } = req.body || {};
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return res.status(400).json({ message: 'Email required.' });
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const verificationToken = generateToken();
  const { data: existing } = await supabase
    .from('forum_users')
    .select('id, verified_at')
    .eq('email', normalized)
    .maybeSingle();

  if (existing) {
    if (existing.verified_at) {
      return res.status(200).json({ message: 'Already verified. You can sign in to post.' });
    }
    const { error: updateError } = await supabase
      .from('forum_users')
      .update({ verification_token: verificationToken })
      .eq('email', normalized);
    if (updateError) {
      console.error('Forum register update error:', updateError);
      return res.status(500).json({ message: 'Could not update. Try again.' });
    }
  } else {
    const { error: insertError } = await supabase.from('forum_users').insert({
      email: normalized,
      verification_token: verificationToken,
    });
    if (insertError) {
      console.error('Forum register insert error:', insertError);
      return res.status(500).json({ message: 'Could not register.' });
    }
  }

  await sendForumVerification(normalized, verificationToken);
  res.status(201).json({ message: 'Verification email sent. Check your inbox.' });
});

// POST /api/forum/verify – verify email (from legacy link with token), returns JWT for posting
forumRouter.post('/verify', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ message: 'Token required.' });
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { data: user, error: findError } = await supabase
    .from('forum_users')
    .select('id, email, verified_at')
    .eq('verification_token', token)
    .maybeSingle();

  if (findError || !user) {
    return res.status(400).json({ message: 'Invalid or expired link.' });
  }

  const { error: updateError } = await supabase
    .from('forum_users')
    .update({ verified_at: new Date().toISOString(), verification_token: null })
    .eq('id', user.id);

  if (updateError) {
    console.error('Forum verify update error:', updateError);
    return res.status(500).json({ message: 'Verification failed.' });
  }

  const forumToken = signForumToken(user.email);
  res.json({ verified: true, token: forumToken });
});

// POST /api/forum/verify-supabase – verify Supabase magic-link JWT, upsert forum user, return forum JWT
forumRouter.post('/verify-supabase', async (req, res) => {
  const auth = req.headers.authorization;
  const accessToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) return res.status(400).json({ message: 'Authorization required.' });
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authUser?.email) {
    return res.status(401).json({ message: 'Invalid or expired link.' });
  }

  const email = authUser.email.trim().toLowerCase();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('forum_users')
    .select('id, verified_at')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    const { error: updateError } = await supabase
      .from('forum_users')
      .update({ verified_at: now, verification_token: null })
      .eq('id', existing.id);
    if (updateError) {
      console.error('Forum verify-supabase update error:', updateError);
      return res.status(500).json({ message: 'Verification failed.' });
    }
  } else {
    const { error: insertError } = await supabase.from('forum_users').insert({
      email,
      verified_at: now,
      verification_token: null,
    });
    if (insertError) {
      console.error('Forum verify-supabase insert error:', insertError);
      return res.status(500).json({ message: 'Could not register.' });
    }
  }

  const forumToken = signForumToken(email);
  res.json({ verified: true, token: forumToken });
});

function normalizeCategory(category) {
  if (category == null) return 'general';
  const s = String(category).trim().toLowerCase();
  return ALLOWED_CATEGORIES.includes(s) ? s : 'general';
}

// POST /api/forum/threads – create thread (requires verified user)
forumRouter.post('/threads', forumAuthMiddleware, async (req, res) => {
  const { title, body, category } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ message: 'Title and body required.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }
  const categoryVal = normalizeCategory(category);

  const insertPayload = {
    author_email: req.forumEmail,
    title: String(title).trim(),
    body: String(body).trim(),
    category: categoryVal,
    status: 'pending',
  };

  const { data: thread, error } = await supabase
    .from('forum_threads')
    .insert(insertPayload)
    .select('id, title, author_email, category, status, created_at')
    .single();

  if (error) {
    console.error('Forum thread insert error:', error);
    if (error.code === '42703' || (error.message && error.message.includes('category'))) {
      return res.status(500).json({
        message: 'Could not create thread. Database may be missing "category" column. Run supabase/add_forum_thread_category.sql in Supabase SQL Editor.',
      });
    }
    return res.status(500).json({ message: 'Could not create thread.' });
  }
  res.status(201).json(thread);
});

// GET /api/forum/threads/:id – get thread and replies (approved only for public)
forumRouter.get('/threads/:id', async (req, res) => {
  if (!supabase) return res.status(404).json({ message: 'Not found.' });
  const { data: thread, error: threadError } = await supabase
    .from('forum_threads')
    .select('id, title, body, author_email, category, status, created_at')
    .eq('id', req.params.id)
    .maybeSingle();

  if (threadError || !thread) {
    return res.status(404).json({ message: 'Not found.' });
  }
  if (thread.status !== 'approved') {
    return res.status(404).json({ message: 'Not found.' });
  }

  const { data: replies } = await supabase
    .from('forum_replies')
    .select('id, body, author_email, created_at')
    .eq('thread_id', thread.id)
    .eq('status', 'approved')
    .order('created_at', { ascending: true });

  res.json({ ...thread, replies: replies || [] });
});

// POST /api/forum/threads/:id/replies – create reply (requires verified user)
forumRouter.post('/threads/:id/replies', forumAuthMiddleware, async (req, res) => {
  const threadId = req.params.id;
  const { body } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ message: 'Reply body required.' });
  }
  if (!supabase) {
    return res.status(503).json({ message: 'Service temporarily unavailable.' });
  }

  const { data: thread, error: threadErr } = await supabase
    .from('forum_threads')
    .select('id')
    .eq('id', threadId)
    .maybeSingle();
  if (threadErr || !thread) {
    return res.status(404).json({ message: 'Thread not found.' });
  }

  const { data: reply, error } = await supabase
    .from('forum_replies')
    .insert({
      thread_id: threadId,
      author_email: req.forumEmail,
      body: String(body).trim(),
      status: 'pending',
    })
    .select('id, thread_id, body, author_email, status, created_at')
    .single();

  if (error) {
    console.error('Forum reply insert error:', error);
    return res.status(500).json({ message: 'Could not create reply.' });
  }
  res.status(201).json(reply);
});
