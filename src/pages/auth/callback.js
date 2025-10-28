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

      // 0) Parse URL (zowel query als hash)
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null
      const hashParams = new URLSearchParams(url?.hash?.slice(1) || '')
      const query = router.query || {}

      const code = query.code // PKCE/OAuth
      const type = (query.type || hashParams.get('type') || '').toLowerCase()
      const err  = query.error || hashParams.get('error')
      const errCode = query.error_code || hashParams.get('error_code')

      // 1) Als er een fout in de link zit (bijv. verlopen), terug naar login met meldinkje
      if (err || errCode) {
        console.error('Auth callback error:', err || errCode)
        return router.replace('/login?m=link-error')
      }

      // 2) PKCE/OAuth flow: ?code=...
      if (code) {
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exchErr) {
          console.error('exchangeCodeForSession error:', exchErr.message)
          return router.replace('/login?m=exchange-failed')
        }
      } else {
        // 3) Geen code → kan email_change / magic link / recovery zijn.
        //    Forceer in alle gevallen een session refresh zodat de client de NIEUWE e-mail/claims ziet.
        try {
          // kleine no-op call die de session hydrateert als er tokens in de URL/hash staan
          await supabase.auth.getUser()
        } catch {}
        try {
          await supabase.auth.refreshSession()
        } catch (e) {
          // refreshSession kan 400 geven als er geen refresh_token bekend is – dat is niet fataal
        }
      }

      // 4) Check of we nu een geldige sessie hebben
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error || !session) {
        console.error('Geen geldige sessie na callback:', error?.message)
        return router.replace('/login?m=no-session')
      }

      // 5) Doorsturen
      const nextParam = typeof query.next === 'string' ? query.next : null
      if (nextParam && nextParam.startsWith('/')) {
        return router.replace(nextParam)
      }
      return router.replace('/dashboard')
    }

    if (router.isReady) handleCallback()
  }, [router])

  return <p className="text-center mt-20">Je wordt ingelogd…</p>
}
