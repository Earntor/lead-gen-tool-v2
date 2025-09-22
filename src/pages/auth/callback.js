// src/pages/auth/callback.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    async function handleCallback() {
      // 1) Wissel de code om voor een sessie (OAuth / Magic Link)
      const code = router.query?.code
      if (code) {
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exchErr) {
          console.error('exchangeCodeForSession error:', exchErr.message)
          return router.replace('/login')
        }
      }

      // 2) Controleer sessie
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error || !session) {
        console.error('Geen geldige sessie gevonden:', error?.message)
        return router.replace('/login')
      }

      // 3) Stuur terug naar `next` (bv. /invite/accept?token=...) of dashboard
      const nextParam = router.query?.next
      if (nextParam && nextParam.startsWith('/')) {
        router.replace(nextParam)
      } else {
        router.replace('/dashboard')
      }
    }

    if (router.isReady) handleCallback()
  }, [router])

  return <p className="text-center mt-20">Je wordt ingelogd...</p>
}
