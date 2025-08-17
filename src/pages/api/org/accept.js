// src/pages/invite/accept.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabaseClient'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [status, setStatus] = useState('idle') // idle | need_login | working | success | error
  const [msg, setMsg] = useState('')

  // Login-link met redirect terug naar de invite
  const loginHref = (() => {
    if (typeof window === 'undefined') return '/login'
    const url = new URL(window.location.href)
    return `/login?next=${encodeURIComponent(url.pathname + url.search)}`
  })()

  useEffect(() => {
    if (!router.isReady) return
    const token = (router.query.token || '').toString().trim()

    let tm // timeout id voor cleanup

    async function run() {
      if (!token) {
        setStatus('error')
        setMsg('Geen uitnodigingscode gevonden. Vraag de admin om een nieuwe link.')
        return
      }

      // Is user ingelogd?
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setStatus('need_login')
        setMsg('Je moet eerst inloggen om de uitnodiging te accepteren.')
        return
      }

      try {
        setStatus('working')
        setMsg('Uitnodiging wordt geaccepteerd…')

        const res = await fetch('/api/org/accept', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token }),
        })

        // Speciaal: sessie verlopen of geen auth → direct naar login
        if (res.status === 401) {
          setStatus('need_login')
          setMsg('Je sessie is verlopen. Log opnieuw in om de uitnodiging te accepteren.')
          return
        }

        const json = await res.json().catch(() => ({}))

        if (!res.ok) {
          switch (json?.error) {
            case 'invalid_or_used_token':
              setMsg('Deze uitnodiging is ongeldig of al gebruikt.')
              break
            case 'invite_expired':
              setMsg('Deze uitnodiging is verlopen. Vraag de admin om een nieuwe uitnodiging.')
              break
            case 'invite_email_mismatch':
              setMsg('Je bent ingelogd met een ander e-mailadres dan waar de uitnodiging naartoe is gestuurd.')
              break
            case 'already_in_another_org':
              setMsg('Je bent al gekoppeld aan een andere organisatie.')
              break
            case 'org_member_limit_reached':
              setMsg('De organisatie heeft het maximum aantal gebruikers bereikt.')
              break
            default:
              setMsg(json?.error || 'Accepteren is mislukt.')
          }
          setStatus('error')
          return
        }

        setStatus('success')
        setMsg('Uitnodiging geaccepteerd!')
        tm = setTimeout(() => router.replace('/account#team'), 1500)
      } catch (e) {
        setStatus('error')
        setMsg(e?.message || 'Er ging iets mis tijdens het accepteren.')
      }
    }

    run()
    return () => { if (tm) clearTimeout(tm) }
  }, [router.isReady, router.query.token, router])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md bg-white border rounded-xl shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold">Uitnodiging accepteren</h1>

        {status === 'idle' && <p className="text-gray-600">Bezig met laden…</p>}

        {status === 'need_login' && (
          <>
            <p className="text-gray-700">{msg}</p>
            <a href={loginHref} className="inline-block px-4 py-2 rounded bg-black text-white">
              Inloggen
            </a>
          </>
        )}

        {status === 'working' && <p className="text-gray-700">{msg}</p>}

        {status === 'success' && (
          <>
            <div className="p-3 rounded bg-green-100 text-green-800">{msg}</div>
            <a href="/account#team" className="inline-block px-4 py-2 rounded bg-black text-white">
              Ga naar Team
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="p-3 rounded bg-red-100 text-red-700">{msg}</div>
            <div className="flex items-center gap-2">
              <a href="/account#team" className="inline-block px-4 py-2 rounded bg-gray-800 text-white">
                Terug naar account
              </a>
              <button onClick={() => location.reload()} className="px-3 py-2 border rounded">
                Opnieuw proberen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
