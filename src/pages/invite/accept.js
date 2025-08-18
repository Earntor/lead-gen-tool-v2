// src/pages/invite/accept.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AcceptInvitePage() {
  const router = useRouter()
  const { token } = router.query

  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Uitnodiging controleren...')

  useEffect(() => {
    async function run() {
      if (!router.isReady) return
      const rawToken = String(token || '').trim()
      if (!rawToken) {
        setStatus('error')
        setMessage('Ongeldige of ontbrekende token.')
        return
      }

      // check sessie
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        // 👇 invite-info ophalen (incl. email)
        const res = await fetch('/api/org/invite-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: rawToken }),
        })
        const json = await res.json()

        if (!res.ok || json?.error) {
          setStatus('error')
          setMessage(
            json?.error === 'invalid_or_used_token'
              ? 'Deze uitnodiging is ongeldig of al gebruikt.'
              : json?.error === 'invite_expired'
              ? 'Deze uitnodiging is verlopen.'
              : `Er ging iets mis: ${json?.error || 'onbekende fout'}`
          )
          return
        }

        // ✅ stuur door naar registratie met invite & email
        const next = encodeURIComponent(`/invite/accept?token=${rawToken}`)
        const email = encodeURIComponent(json.email)
        router.replace(`/register?invite=${rawToken}&email=${email}&next=${next}`)
        return
      }

      // Als ingelogd → accepteer invite direct
      try {
        const res = await fetch('/api/org/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: rawToken }),
        })
        const json = await res.json()

        if (!res.ok || json?.error) {
          setStatus('error')
          setMessage(
            json?.error === 'invalid_or_used_token'
              ? 'Deze uitnodiging is ongeldig of al gebruikt.'
              : json?.error === 'invite_expired'
              ? 'Deze uitnodiging is verlopen.'
              : `Er ging iets mis: ${json?.error || 'onbekende fout'}`
          )
          return
        }

        setStatus('success')
        setMessage('Uitnodiging geaccepteerd! Je gaat zo door naar het dashboard...')
        setTimeout(() => router.replace('/dashboard'), 1200)
      } catch (e) {
        setStatus('error')
        setMessage(`Er ging iets mis: ${e?.message || e}`)
      }
    }
    run()
  }, [router, token])

  return (
    <main style={{ maxWidth: 520, margin: '48px auto', padding: 16, fontFamily: 'system-ui, Arial' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Uitnodiging accepteren</h1>
      <p style={{ marginBottom: 8 }}>{message}</p>
      {status === 'loading' && <p>Even geduld...</p>}
      {status === 'error' && (
        <button
          onClick={() => router.replace('/')}
          style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd' }}
        >
          Terug naar home
        </button>
      )}
    </main>
  )
}
