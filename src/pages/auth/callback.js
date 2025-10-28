// src/pages/auth/callback.js
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()
  const ranRef = useRef(false)

  useEffect(() => {
    async function handleCallback() {
      if (ranRef.current) return
      ranRef.current = true

      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null
      const qp   = router.query || {}
      const hp   = new URLSearchParams(url?.hash?.slice(1) || '')

      // Lees alle mogelijke parameters (zowel query als hash)
      const code       = qp.code || null
      const typeParam  = String(qp.type || hp.get('type') || '').toLowerCase()
      const tokenHash  = qp.token_hash || hp.get('token_hash') || qp.token || hp.get('token') || null
      const accessTok  = qp.access_token || hp.get('access_token') || null
      const errorStr   = qp.error || hp.get('error') || null
      const errorCode  = qp.error_code || hp.get('error_code') || null

      // 0) Als er overduidelijk een fout is meegegeven én het is géén email_change poging, terug naar login
      if ((errorStr || errorCode) && typeParam !== 'email_change') {
        console.error('[auth/callback] error:', errorStr || errorCode)
        return router.replace('/login?m=link-error')
      }

      // 1) OAuth/PKCE (bv. social) → ?code=...
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[auth/callback] exchangeCodeForSession:', error.message)
          return router.replace('/login?m=exchange-failed')
        }
      }

      // 2) Magic link / recovery → #access_token=...
      else if (accessTok) {
        // Supabase JS hydrateert zelf vanuit hash; een no-op call is genoeg
        try { await supabase.auth.getUser() } catch {}
      }

      // 3) Email change → ?token_hash=...&type=email_change
      else if (typeParam === 'email_change' && tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          type: 'email_change',
          token_hash: tokenHash,
        })
        if (error) {
          console.error('[auth/callback] verifyOtp(email_change):', error.message)
          return router.replace('/login?m=link-error')
        }
      }

      // 4) Sessie zekerstellen (sommige flows hebben refresh nodig)
      try { await supabase.auth.refreshSession() } catch {}
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        return router.replace('/login?m=no-session')
      }

      // 5) Doorsturen
      const nextParam = typeof qp.next === 'string' ? qp.next : null
      if (nextParam && nextParam.startsWith('/')) {
        return router.replace(nextParam)
      }
      return router.replace('/dashboard')
    }

    if (router.isReady) { handleCallback() }
  }, [router])

  return <p className="text-center mt-20">Je wordt ingelogd…</p>
}
