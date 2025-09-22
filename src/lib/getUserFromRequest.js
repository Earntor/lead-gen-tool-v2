// lib/getUserFromRequest.js
import { supabaseAdmin } from './supabaseAdminClient'
import { createServerClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('Supabase env ontbreekt: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Kleine helper om Set-Cookie correct te append’en
function appendSetCookie(res, cookieVal) {
  const prev = res.getHeader?.('Set-Cookie')
  if (!prev) res.setHeader?.('Set-Cookie', cookieVal)
  else if (Array.isArray(prev)) res.setHeader?.('Set-Cookie', [...prev, cookieVal])
  else res.setHeader?.('Set-Cookie', [prev, cookieVal])
}

export async function getUserFromRequest(req, res) {
  try {
    // 1) Bearer-token pad (blijft zoals je had)
    const auth = req.headers.authorization || req.headers.Authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data?.user) return { user: null, error: error?.message || 'invalid_token' }
      return { user: data.user }
    }

    // 2) Cookie/sessie pad (als geen Bearer)
    const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        get: (name) => req.cookies?.[name],
        set: (name, value, options) => {
          // @supabase/ssr geeft hier al correcte string terug
          const cookieStr = `${name}=${encodeURIComponent(value)}; Path=${options?.path || '/'}${options?.maxAge ? `; Max-Age=${Math.floor(options.maxAge)}` : ''}${options?.domain ? `; Domain=${options.domain}` : ''}${options?.secure ? '; Secure' : ''}${options?.httpOnly ? '; HttpOnly' : ''}${options?.sameSite ? `; SameSite=${options.sameSite}` : ''}${options?.expires ? `; Expires=${options.expires.toUTCString()}` : ''}`
          appendSetCookie(res, cookieStr)
        },
        remove: (name, options) => {
          const cookieStr = `${name}=; Path=${options?.path || '/'}; Max-Age=0`
          appendSetCookie(res, cookieStr)
        },
      },
    })

    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) return { user: null, error: error?.message || 'no_user_from_cookies' }
    return { user: data.user }
  } catch (e) {
    return { user: null, error: e?.message || String(e) }
  }
}
