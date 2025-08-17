// lib/getUserFromRequest.js
import { supabaseAdmin } from './supabaseAdminClient';

export async function getUserFromRequest(req) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return { user: null, error: 'no_token' };

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return { user: null, error: error?.message || 'invalid_token' };
    return { user: data.user };
  } catch (e) {
    return { user: null, error: e.message };
  }
}
