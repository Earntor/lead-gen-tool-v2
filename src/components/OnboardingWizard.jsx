// components/OnboardingWizard.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const roleOptions = ['Sales', 'Marketing', 'Management', 'Technisch', 'Overig']

export default function OnboardingWizard({ open, onClose, onComplete }) {
  const [visible, setVisible] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [orgId, setOrgId] = useState(null)
  const [token, setToken] = useState(null)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('')

  const [step, setStep] = useState(1)
  const [totalSteps, setTotalSteps] = useState(3)

  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef(null)
  const [pollStatus, setPollStatus] = useState('idle')

useEffect(() => {
  if (open === true) setVisible(true);
  if (open === false) setVisible(false);
}, [open]);


  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      const t = data?.session?.access_token
      setToken(t || null)
      if (!t) return

      const resp = await fetch('/api/onboarding?action=state', {
        headers: { Authorization: `Bearer ${t}` },
      })
      const json = await resp.json().catch(() => ({}))
      if (cancelled) return
      if (!json?.ok) return

      setIsOwner(!!json.isOwner)
      setOrgId(json.orgId || null)

      const prefs = json.preferences || {}
      const onboarding = prefs.onboarding || {}
      setFullName(json?.profile?.full_name || '')
      setPhone(json?.profile?.phone || '')
      setRole(prefs.user_role || '')

      const owner = !!json.isOwner
      setTotalSteps(owner ? 4 : 3)

      let s = 1
      if (onboarding.step === 'profile_done') s = 2
      if (onboarding.step === 'role_done') s = owner ? 3 : 3
      if (onboarding.completed) {
        setVisible(false)
        return
      }
      setStep(s)
    })()

    return () => {
      cancelled = true
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  const progress = useMemo(() => Math.round((step / totalSteps) * 100), [step, totalSteps])
  if (!visible) return null

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  async function saveProfile() {
if (!token) {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token || null
  setToken(t)
  if (!t) {
    alert('Niet ingelogd (geen token). Ververs de pagina en probeer opnieuw.')
    return
  }
}
    if (!fullName.trim()) return alert('Vul je naam in')
    setLoading(true)
    try {
      const resp = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'saveProfile', fullName, phone }),
      })
      if (!resp.ok) throw new Error((await resp.json()).error || 'Opslaan mislukt')
      setStep((s) => s + 1)
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function saveRole() {
if (!token) {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token || null
  setToken(t)
  if (!t) {
    alert('Niet ingelogd (geen token). Ververs de pagina en probeer opnieuw.')
    return
  }
}
    if (!role) return alert('Kies je rol')
    setLoading(true)
    try {
      const resp = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'saveRole', role }),
      })
      if (!resp.ok) throw new Error((await resp.json()).error || 'Opslaan mislukt')
      setStep((s) => s + 1)
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function complete() {
if (!token) {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token || null
  setToken(t)
  if (!t) {
    alert('Niet ingelogd (geen token). Ververs de pagina en probeer opnieuw.')
    return
  }
}
    setLoading(true)
    try {
      const resp = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'complete' }),
      })
      if (!resp.ok) throw new Error((await resp.json()).error || 'Afronden mislukt')
      setVisible(false)
    onComplete && onComplete();
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function snooze(minutes = 60 * 24) {
if (!token) {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token || null
  setToken(t)
  if (!t) {
    alert('Niet ingelogd (geen token). Ververs de pagina en probeer opnieuw.')
    return
  }
}
    setLoading(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'snooze', minutes }),
      })
      setVisible(false)
      onClose && onClose();
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  function startPolling() {
  if (!orgId) return alert('Org ontbreekt, ververs de pagina en probeer opnieuw.');
  if (pollRef.current) return;          // voorkom dubbele intervals
  setPolling(true);
  setPollStatus('checking');

  const tick = async () => {
    try {
 const resp = await fetch(
   `/api/check-tracking?projectId=${encodeURIComponent(orgId)}`,
   { headers: token ? { Authorization: `Bearer ${token}` } : {} }
 )      // Als in de tussentijd gestopt is, niet meer updaten:
      if (!pollRef.current) return;

      const json = await resp.json();
      if (!pollRef.current) return;

      if (json?.status === 'ok') {
        setPollStatus('ok');
        // eerst interval weg, dan UI-status updaten
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setPolling(false);
      } else {
        setPollStatus('not_found');
      }
    } catch {
      if (!pollRef.current) return;
      setPollStatus('error');
    }
  };

  tick();
  pollRef.current = setInterval(tick, 5000);
}

function stopPolling() {
  if (pollRef.current) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }
  setPolling(false);
  setPollStatus('idle');
}




  const ActionBar = ({ onPrimary, primaryText, onSecondary, secondaryText, disabled }) => (
    <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
      <button
        onClick={onPrimary}
        disabled={disabled}
        className="inline-flex justify-center rounded-lg bg-black text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
      >
        {primaryText}
      </button>
      {onSecondary && (
        <button
          onClick={onSecondary}
          className="inline-flex justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          {secondaryText}
        </button>
      )}
      <button
        onClick={() => snooze(60 * 24)}
        className="ml-auto text-sm text-gray-500 hover:text-gray-700"
        title="Later afronden (24 uur)"
      >
        Later afronden
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[1000]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border">
          <div className="p-4 sm:p-5 border-b">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-semibold text-gray-800">Snel aan de slag</h2>
              <div className="text-xs text-gray-500">Stap {step} / {totalSteps}</div>
            </div>
            <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
              <div className="h-2 bg-blue-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {step === 1 && (
              <>
                <p className="text-sm text-gray-700 mb-4">Vul je gegevens in. We gebruiken dit voor je account en in de welkomstmail.</p>
                <label className="block text-sm font-medium text-gray-700 mb-1">Naam</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Voornaam Achternaam"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefoon (optioneel)</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+31 6 12 34 56 78"
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
+ <ActionBar onPrimary={saveProfile} primaryText={loading ? 'Opslaan…' : 'Volgende'} disabled={loading || !token} />
              </>
            )}

            {step === 2 && (
              <>
                <p className="text-sm text-gray-700 mb-4">Wat is je rol in jouw organisatie?</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {roleOptions.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setRole(opt)}
                      className={`rounded-lg border px-3 py-2 text-sm text-left hover:bg-gray-50 ${role === opt ? 'border-blue-600 ring-2 ring-blue-200' : ''}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <ActionBar
                  onPrimary={saveRole}
                  primaryText={loading ? 'Opslaan…' : 'Volgende'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
                  disabled={loading || !token}
                />
              </>
            )}

            {step === 3 && isOwner && (
              <>
                <p className="text-sm text-gray-700">
                  Plaats het tracking script op je website. Klaar? Start de check hieronder – we herkennen automatisch zodra het script een “hello ping” doet.
                </p>
                <div className="mt-4 rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                  <p className="font-medium mb-1">Korte uitleg</p>
                  <ol className="list-decimal ml-5 space-y-1">
                    <li>Plak je script in de &lt;head&gt; van je site.</li>
                    <li>Publiceer/refresh je site.</li>
                    <li>Klik hieronder op <b>Start check</b>.</li>
                  </ol>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {!polling ? (
                    <button onClick={startPolling} className="rounded-lg bg-black text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800">
                      Start check
                    </button>
                  ) : (
                    <button onClick={stopPolling} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
                      Stop check
                    </button>
                  )}
                  <span className="text-sm text-gray-600">
                    Status:{' '}
                    {pollStatus === 'idle' && 'klaar om te starten'}
                    {pollStatus === 'checking' && 'controleren…'}
                    {pollStatus === 'not_found' && 'nog niets gezien'}
                    {pollStatus === 'ok' && '✅ script gezien'}
                    {pollStatus === 'error' && 'fout bij check'}
                  </span>
                </div>
                <ActionBar
                  onPrimary={() => setStep((s) => s + 1)}
                  primaryText={pollStatus === 'ok' ? 'Volgende' : 'Sla voorlopig over'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
                />
              </>
            )}

            {((!isOwner && step === 3) || (isOwner && step === 4)) && (
              <>
                <h3 className="text-base font-semibold text-gray-800 mb-2">Klaar! 🎉</h3>
                <p className="text-sm text-gray-700">
                  Je account staat. Je kunt direct verder in het dashboard. Je welkomstmail is verstuurd na het kiezen van je rol.
                </p>
                <ActionBar
                  onPrimary={complete}
                  primaryText={loading ? 'Afronden…' : 'Naar dashboard'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
 disabled={loading || !token}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
