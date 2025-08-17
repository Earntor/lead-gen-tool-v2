import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Gebruiker' },
  { value: 'viewer', label: 'Viewer' },
]

// Houd dit gelijk aan je DB-limiet
const SEAT_LIMIT = 5

export default function TeamTab() {
  // Context
  const [orgId, setOrgId] = useState(null)
  const [meRole, setMeRole] = useState(null)
  const [ownerId, setOwnerId] = useState(null)

  // UI state
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteLink, setInviteLink] = useState('')

  const [orgName, setOrgName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Zoeken/filteren
  const [q, setQ] = useState('')

  const getToken = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return session?.access_token || null
    } catch {
      return null
    }
  }, [])

  // === Context laden: orgId, mijn rol, organisatienaam, owner ===
  const loadContext = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) {
        setOrgId(null)
        setMeRole(null)
        setOwnerId(null)
        return
      }

      // 1) huidige org
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_org_id')
        .eq('id', userId)
        .single()
      const currentOrg = profile?.current_org_id || null
      setOrgId(currentOrg)

      if (!currentOrg) {
        setMeRole(null)
        setOrgName('')
        setOwnerId(null)
        return
      }

      // 2) mijn rol in deze org
      const { data: myMember } = await supabase
        .from('organization_members')
        .select('role')
        .eq('org_id', currentOrg)
        .eq('user_id', userId)
        .maybeSingle()
      setMeRole(myMember?.role || null)

      // 3) org naam + owner ophalen
      const { data: org } = await supabase
        .from('organizations')
        .select('name, owner_user_id')
        .eq('id', currentOrg)
        .single()
      setOrgName(org?.name || '')
      setOwnerId(org?.owner_user_id || null)
    } catch {
      // stil falen: context blijft onveranderd
    }
  }, [])

  // === Leden laden via jouw API ===
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

  // === Openstaande invites laden (direct via Supabase; alleen admin ziet ze) ===
  const loadInvites = useCallback(async () => {
    try {
      if (!orgId || meRole !== 'admin') {
        setInvites([])
        return
      }
      const { data: rows } = await supabase
        .from('organization_invites')
        .select('id,email,role,token,expires_at,created_at')
        .eq('org_id', orgId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      setInvites(rows || [])
    } catch {
      setInvites([])
    }
  }, [orgId, meRole])

  useEffect(() => {
    (async () => {
      await loadContext()
      await loadMembers()
      await loadInvites()
    })()
  }, [loadContext, loadMembers, loadInvites])

  // Derived UI helpers
  const seatCount = members.length
  const atLimit = seatCount >= SEAT_LIMIT
  const adminIds = members.filter(m => m.role === 'admin').map(m => m.user_id)
  const isLastAdmin = (user_id) => adminIds.length === 1 && adminIds[0] === user_id

  // Filtering
  const filtered = members.filter(m => {
    const hay = `${m.full_name || ''} ${m.email || ''} ${m.role || ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  // === Acties ===
  async function sendInvite(e) {
    e.preventDefault()
    setInviteLink('')
    setError(null)
    try {
      if (meRole !== 'admin') return setError('Alleen admins mogen uitnodigen.')
      if (atLimit) return setError(`Limiet bereikt (${seatCount}/${SEAT_LIMIT}). Verwijder eerst iemand.`)

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
      loadInvites()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij uitnodigen.')
    }
  }

  async function revokeInvite(id) {
    if (!confirm('Deze uitnodiging intrekken?')) return
    try {
      if (meRole !== 'admin') return setError('Alleen admins mogen uitnodigingen intrekken.')
      const { error } = await supabase.from('organization_invites').delete().eq('id', id)
      if (error) return setError(error.message || 'Intrekken mislukt.')
      loadInvites()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij intrekken.')
    }
  }

  async function changeRole(user_id, role) {
    setError(null)
    try {
      if (meRole !== 'admin') return setError('Alleen admins mogen rollen wijzigen.')
      if (isLastAdmin(user_id) && role !== 'admin') {
        return setError('Minstens één admin vereist.')
      }
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
      if (meRole !== 'admin') return setError('Alleen admins mogen leden verwijderen.')
      if (isLastAdmin(user_id)) return setError('Minstens één admin vereist.')
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
      if (meRole !== 'admin') {
        setSavingName(false)
        return setError('Alleen admins mogen de naam wijzigen.')
      }
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
      await loadContext() // naam/owner opnieuw ophalen
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
      const toCopy = String(text || '')
      if (!toCopy) return
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(toCopy)
        alert('Link gekopieerd')
      } else {
        const ta = document.createElement('textarea')
        ta.value = toCopy
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

  const inviteBase =
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ''

  return (
    <div className="space-y-6">
      {/* Context + Seats */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {meRole ? <>Jouw rol: <span className="font-medium">{meRole}</span></> : 'Rol laden…'}
          {ownerId && (
            <span className="ml-2 text-xs text-gray-500">• Owner: {ownerId.slice(0, 8)}…</span>
          )}
        </div>
        <div className="text-sm text-gray-600">
          Seats: <span className="font-medium">{seatCount}/{SEAT_LIMIT}</span>
        </div>
      </div>
      {!orgId && <div className="text-sm text-red-600">Geen organisatie gekoppeld</div>}

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
            placeholder="Organisatienaam"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={meRole !== 'admin'}
          />
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={savingName || !orgName.trim() || meRole !== 'admin'}
          >
            {savingName ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
        {meRole !== 'admin' && (
          <p className="text-xs text-gray-500 mt-1">Alleen admin kan de naam wijzigen.</p>
        )}
      </form>

      {/* Zoeken */}
      <div className="p-4 border rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Teamleden</h3>
          <button onClick={() => { loadMembers(); loadInvites(); }} className="text-sm underline">
            Vernieuwen
          </button>
        </div>

        <input
          className="border rounded px-3 py-2 w-full md:w-1/2 mb-3"
          placeholder="Zoek op naam, e-mail of rol…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {loading ? (
          <p>Leden laden…</p>
        ) : filtered.length === 0 ? (
          <p>Geen leden gevonden.</p>
        ) : (
          <ul className="divide-y">
            {filtered.map((m) => (
              <li key={m.user_id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    <span>{m.full_name || m.email || m.user_id}</span>
                    {ownerId === m.user_id && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 border">
                        Owner
                      </span>
                    )}
                    {m.role === 'admin' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">Sinds: {safeSince(m?.since)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m.user_id, e.target.value)}
                    className="border rounded px-2 py-1"
                    disabled={meRole !== 'admin' || isLastAdmin(m.user_id)}
                  >
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button
                    onClick={() => removeMember(m.user_id)}
                    className="text-red-600 text-sm"
                    disabled={meRole !== 'admin' || isLastAdmin(m.user_id)}
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
            disabled={meRole !== 'admin' || atLimit}
          />
        <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="border rounded px-3 py-2"
            disabled={meRole !== 'admin' || atLimit}
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={meRole !== 'admin' || atLimit}
          >
            Uitnodigen
          </button>
        </div>

        {atLimit && (
          <p className="text-xs text-gray-500">
            Limiet bereikt ({seatCount}/{SEAT_LIMIT}). Verwijder eerst iemand om te kunnen uitnodigen.
          </p>
        )}

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

      {/* Openstaande uitnodigingen (alleen admin) */}
      {meRole === 'admin' && (
        <div className="p-4 border rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Openstaande uitnodigingen</h3>
            <span className="text-sm text-gray-500">{invites.length} open</span>
          </div>

          {invites.length === 0 ? (
            <p className="text-sm text-gray-600">Geen openstaande uitnodigingen.</p>
          ) : (
            <ul className="divide-y">
              {invites.map((inv) => {
                const expires = new Date(inv.expires_at)
                const expired = Number.isNaN(expires.getTime()) ? '-' : expires.toLocaleString('nl-NL')
                const link = inviteBase ? `${inviteBase}/invite/accept?token=${encodeURIComponent(inv.token)}` : ''
                return (
                  <li key={inv.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{inv.email}</div>
                      <div className="text-xs text-gray-500">
                        Rol: {inv.role} • Verloopt: {expired}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(link)}
                        className="px-3 py-1 border rounded text-sm"
                      >
                        Kopieer link
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvite(inv.id)}
                        className="px-3 py-1 border rounded text-sm text-red-600"
                      >
                        Intrekken
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
