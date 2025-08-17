import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Gebruiker' },
  { value: 'viewer', label: 'Viewer' },
]

export default function TeamTab() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteLink, setInviteLink] = useState('')

  const [orgName, setOrgName] = useState('')
  const [savingName, setSavingName] = useState(false)

  const getToken = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return session?.access_token || null
    } catch {
      return null
    }
  }, [])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) {
        setMembers([])
        setError('Niet ingelogd of sessie verlopen.')
        return
      }
      const res = await fetch('/api/org/members', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMembers([])
        setError(json?.error || 'Kon leden niet laden.')
        return
      }
      setMembers(Array.isArray(json.members) ? json.members : [])
    } catch (e) {
      setMembers([])
      setError(e?.message || 'Onbekende fout bij laden leden.')
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { loadMembers() }, [loadMembers])

  async function sendInvite(e) {
    e.preventDefault()
    setInviteLink('')
    setError(null)
    try {
      const token = await getToken()
      if (!token) return setError('Niet ingelogd.')
      const res = await fetch('/api/org/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(json?.error || 'Uitnodigen mislukt.')
      setInviteLink(json.inviteUrl)
      setInviteEmail('')
      setInviteRole('member')
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij uitnodigen.')
    }
  }

  async function changeRole(user_id, role) {
    setError(null)
    try {
      const token = await getToken()
      if (!token) return setError('Niet ingelogd.')
      const res = await fetch('/api/org/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_user_id: user_id, role }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(json?.error || 'Rol wijzigen mislukt.')
      loadMembers()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij rol wijzigen.')
    }
  }

  async function removeMember(user_id) {
    if (!confirm('Weet je zeker dat je dit lid wilt verwijderen?')) return
    setError(null)
    try {
      const token = await getToken()
      if (!token) return setError('Niet ingelogd.')
      const res = await fetch('/api/org/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_user_id: user_id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(json?.error || 'Verwijderen mislukt.')
      loadMembers()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij verwijderen.')
    }
  }

  async function saveOrgName(e) {
    e.preventDefault()
    setSavingName(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) {
        setSavingName(false)
        return setError('Niet ingelogd.')
      }
      const res = await fetch('/api/org/update-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: orgName }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(json?.error || 'Opslaan mislukt.')
      alert('Naam opgeslagen')
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij opslaan.')
    } finally {
      setSavingName(false)
    }
  }

  function safeSince(ts) {
    if (!ts) return '-'
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('nl-NL')
  }

  async function copyToClipboard(text) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        alert('Link gekopieerd')
      } else {
        // Fallback
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        alert('Link gekopieerd')
      }
    } catch {
      alert('Kopiëren niet gelukt')
    }
  }

  return (
    <div className="space-y-6">
      {/* Foutmelding */}
      {error && (
        <div className="p-3 rounded bg-red-100 text-red-700 text-sm">
          {String(error)}
        </div>
      )}

      {/* Organisatienaam */}
      <form onSubmit={saveOrgName} className="p-4 border rounded-xl">
        <h3 className="font-semibold mb-2">Organisatienaam</h3>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="Nieuwe organisatienaam"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={savingName || !orgName.trim()}
          >
            {savingName ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">Alleen Admin kan de naam wijzigen.</p>
      </form>

      {/* Leden */}
      <div className="p-4 border rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Teamleden</h3>
          <button onClick={loadMembers} className="text-sm underline">Vernieuwen</button>
        </div>

        {loading ? (
          <p>Leden laden…</p>
        ) : members.length === 0 ? (
          <p>Geen leden gevonden.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{m.full_name || m.email || m.user_id}</div>
                  <div className="text-xs text-gray-500">Sinds: {safeSince(m?.since)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m.user_id, e.target.value)}
                    className="border rounded px-2 py-1"
                  >
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button
                    onClick={() => removeMember(m.user_id)}
                    className="text-red-600 text-sm"
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Uitnodigen */}
      <form onSubmit={sendInvite} className="p-4 border rounded-xl space-y-3">
        <h3 className="font-semibold">Gebruiker uitnodigen</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="email"
            required
            className="border rounded px-3 py-2"
            placeholder="email@bedrijf.nl"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="border rounded px-3 py-2"
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button className="px-4 py-2 rounded bg-black text-white">Uitnodigen</button>
        </div>

        {inviteLink && (
          <div className="bg-gray-50 border rounded p-3 text-sm">
            <div className="mb-2">Uitnodigingslink (7 dagen geldig):</div>
            <div className="flex gap-2">
              <input className="flex-1 border rounded px-2 py-1" value={inviteLink} readOnly />
              <button
                type="button"
                onClick={() => copyToClipboard(inviteLink)}
                className="px-3 py-1 border rounded"
              >
                Kopieer
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
