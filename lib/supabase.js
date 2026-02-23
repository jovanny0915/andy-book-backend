import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('Supabase: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. DB operations will fail.');
}

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;
