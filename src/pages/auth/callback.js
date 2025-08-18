// src/pages/auth/callback.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Fout bij sessie ophalen:', error.message)
        router.replace('/login')
        return
      }

      // ✅ Invite-token accepteren indien aanwezig
      const inviteToken = router.query?.invite
      if (inviteToken) {
        try {
          await fetch('/api/org/accept-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteToken }),
          })
        } catch (e) {
          console.error('Invite accepteren mislukt:', e)
        }
      }

      // Daarna redirect
      const nextParam = router.query?.next
      if (nextParam && nextParam.startsWith('/')) {
        router.replace(nextParam)
      } else {
        router.replace('/dashboard')
      }
    }

    handleCallback()
  }, [router])

  return <p className="text-center mt-20">Je wordt ingelogd...</p>
}
