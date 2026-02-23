/**
 * Admin auth: verify Supabase JWT and ensure the user's email exists in admin_users table.
 * Used to protect /api/admin/* routes.
 */

import { supabase } from './supabase.js';

/**
 * Check if the given email is in the admin_users table (case-insensitive).
 */
export async function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const { data, error } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', normalized)
    .maybeSingle();

  return !error && !!data;
}

/**
 * Verify Bearer token as Supabase access token and ensure user is in admin_users.
 * On success: sets req.adminUser = { id, email } and calls next().
 * On failure: sends 401 or 403 and does not call next().
 */
export async function adminAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const accessToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  if (!supabase) {
    return res.status(503).json({ message: 'Service unavailable.' });
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user?.email) {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }

  const allowed = await isAdminEmail(user.email);
  if (!allowed) {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }

  req.adminUser = { id: user.id, email: user.email };
  next();
}
