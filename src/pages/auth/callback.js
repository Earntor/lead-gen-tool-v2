// src/pages/auth/callback.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    async function handleCallback() {

       const code = router.query?.code
   if (code) {
     const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
     if (exchErr) {
       console.error('exchangeCodeForSession error:', exchErr.message)
       return router.replace('/login')
     }
   }
      // 1) Haal de sessie op (werkt na password + na OAuth)
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error || !session) {
        console.error('Geen geldige sessie gevonden:', error?.message)
        router.replace('/login')
        return
      }

      // 2) Invite-token accepteren (alleen als die er is)
      const inviteToken = router.query?.invite || router.query?.token
      if (inviteToken) {
        try {
          const res = await fetch('/api/org/accept', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`, // ✅ belangrijk
  },
  body: JSON.stringify({ token: inviteToken }),
})

          if (!res.ok) {
            console.error('Invite accepteren mislukt:', await res.text())
          }
        } catch (e) {
          console.error('Invite API error:', e)
        }
      }

      // 3) Redirect naar next of dashboard
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
