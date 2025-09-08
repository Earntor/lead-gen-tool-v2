// src/components/TeamTab.jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Gebruiker' },
  { value: 'viewer', label: 'Viewer' },
]

// Houd dit gelijk aan je DB-limiet (of maak ‘m later dynamisch)
const SEAT_LIMIT = 5

export default function TeamTab() {
  // Context
  const [orgId, setOrgId] = useState(null)
  const [meRole, setMeRole] = useState(null)
  const [ownerId, setOwnerId] = useState(null)
  const [selfId, setSelfId] = useState(null)

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

  // Zoeken / notices
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState(null) // {type:'success'|'warning'|'error', text:string} | null
  function flash(type, text, ms = 4500) {
    setNotice({ type, text })
    if (ms) setTimeout(() => setNotice(null), ms)
  }

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
      setSelfId(userId)
      if (!userId) {
        setOrgId(null)
        setMeRole(null)
        setOwnerId(null)
        setOrgName('')
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

      // 2) mijn rol
      const { data: myMember } = await supabase
        .from('organization_members')
        .select('role')
        .eq('org_id', currentOrg)
        .eq('user_id', userId)
        .maybeSingle()
      setMeRole(myMember?.role || null)

      // 3) org naam + owner
      const { data: org } = await supabase
        .from('organizations')
        .select('name, owner_user_id')
        .eq('id', currentOrg)
        .single()
      setOrgName(org?.name || '')
      setOwnerId(org?.owner_user_id || null)
    } catch {
      // stil falen
    }
  }, [])

  // === Leden laden via je API (service-role) ===
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
      const list = Array.isArray(json.members) ? json.members : []
      setMembers(list)

      // Rol betrouwbaarder afleiden uit lijst (werkt voor ALLE admins)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id
        if (uid) {
          const mine = list.find(m => m.user_id === uid)
          if (mine?.role) setMeRole(mine.role)
        }
      } catch {}
    } catch (e) {
      setMembers([])
      setError(e?.message || 'Onbekende fout bij laden leden.')
    } finally {
      setLoading(false)
    }
  }, [getToken])

  // Afgeleide admin-status
  const derivedIsAdmin = members.some(m => m.user_id === selfId && m.role === 'admin')
  const canAdmin = (meRole === 'admin') || derivedIsAdmin

  // === Openstaande invites laden (alleen admin) ===
  const loadInvites = useCallback(async () => {
    try {
      if (!orgId || !canAdmin) {
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
  }, [orgId, canAdmin])

  // Initieel laden
  useEffect(() => {
    (async () => {
      await loadContext()
      await loadMembers()
    })()
  }, [loadContext, loadMembers])

  // Invites ophalen zodra adminstatus/orga bekend is
  useEffect(() => {
    if (orgId && canAdmin) loadInvites()
  }, [orgId, canAdmin, loadInvites])

  // Derived helpers
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
      if (!canAdmin) return setError('Alleen admins mogen uitnodigen.')
      if (atLimit) return setError(`Limiet bereikt (${seatCount}/${SEAT_LIMIT}). Verwijder eerst iemand.`)

      const emailTo = inviteEmail.trim().toLowerCase()
      const token = await getToken()
      if (!token) return setError('Niet ingelogd.')

      const res = await fetch('/api/org/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: emailTo, role: inviteRole }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (json?.error === 'already_member') {
          flash('error', 'Deze gebruiker is al lid van de organisatie.')
          return
        }
        if (json?.error === 'not_org_admin') {
          flash('error', 'Je bent geen admin in deze organisatie.')
          return
        }
        if (json?.error === 'org_member_limit_reached') {
          flash('error', 'Het maximum aantal gebruikers is bereikt.')
          return
        }
        return setError(json?.error || 'Uitnodigen mislukt.')
      }

      setInviteLink(json.inviteUrl || '')
      if (json.emailed) {
        flash('success', `Uitnodiging verstuurd naar ${emailTo}.`)
      } else {
        flash('warning', `E-mail verzenden lukte niet. Kopieer de link hieronder en stuur deze handmatig naar ${emailTo}.`)
      }

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
      if (!canAdmin) return setError('Alleen admins mogen uitnodigingen intrekken.')
      const { error } = await supabase.from('organization_invites').delete().eq('id', id)
      if (error) return setError(error.message || 'Intrekken mislukt.')
      flash('success', 'Uitnodiging ingetrokken.')
      loadInvites()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij intrekken.')
    }
  }

  async function changeRole(user_id, role) {
    setError(null)
    try {
      if (!canAdmin) return setError('Alleen admins mogen rollen wijzigen.')
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
      flash('success', 'Rol bijgewerkt.')
      loadMembers()
    } catch (e) {
      setError(e?.message || 'Onbekende fout bij rol wijzigen.')
    }
  }

  async function removeMember(user_id) {
    if (!confirm('Weet je zeker dat je dit lid wilt verwijderen?')) return
    setError(null)
    try {
      if (!canAdmin) return setError('Alleen admins mogen leden verwijderen.')
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
      flash('success', 'Lid verwijderd.')
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
      if (!canAdmin) {
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

      flash('success', 'Naam opgeslagen.')
      await loadContext()
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
        flash('success', 'Link gekopieerd.')
      } else {
        const ta = document.createElement('textarea')
        ta.value = toCopy
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        flash('success', 'Link gekopieerd.')
      }
    } catch {
      flash('error', 'Kopiëren niet gelukt.')
    }
  }

  const inviteBase =
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ''

  // Kleine icon helpers (geen extra libs)
  const IconSearch = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z" />
    </svg>
  )
  const IconRefresh = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 1119 5" />
    </svg>
  )

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500 mt-1">
            Beheer je team, rollen en uitnodigingen.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Owner bovenaan is bewust NIET zichtbaar (modern, minimal) */}
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 bg-white">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Jouw rol:&nbsp;<b className="lowercase">{meRole || 'laden…'}</b>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 bg-white">
            Seats&nbsp;<b>{members.length}/{SEAT_LIMIT}</b>
          </span>
        </div>
      </div>

      {/* Error / Notice */}
      {(error || notice) && (
        <div className="space-y-2">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {String(error)}
            </div>
          )}
          {notice && (
            <div
              className={`p-3 rounded-lg text-sm border ${
                notice.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : notice.type === 'warning'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-red-50 text-red-800 border-red-200'
              }`}
            >
              {notice.text}
            </div>
          )}
        </div>
      )}

      {/* Organisatienaam (card) */}
      <form onSubmit={saveOrgName} className="rounded-2xl border p-4 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Organisatienaam</h3>
          {!canAdmin && <span className="text-xs text-gray-500">Alleen admin kan wijzigen</span>}
        </div>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Organisatienaam"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!canAdmin}
          />
          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
            disabled={savingName || !orgName.trim() || !canAdmin}
          >
            {savingName ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </form>

      {/* Teamleden (card) */}
      <div className="rounded-2xl border p-4 bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h3 className="font-semibold">Teamleden</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
                <IconSearch />
              </span>
              <input
                className="border rounded-lg pl-8 pr-3 py-2 w-[240px] focus:outline-none focus:ring-2 focus:ring-black/10"
                placeholder="Zoek op naam, e-mail of rol…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button
  onClick={() => { loadMembers(); if (orgId && canAdmin) loadInvites(); }}
  className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
>
  Vernieuwen
</button>
          </div>
        </div>

        {!orgId && (
          <div className="text-sm text-red-600">Geen organisatie gekoppeld</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-600">Geen leden gevonden.</div>
        ) : (
          <ul className="divide-y">
            {filtered.map((m) => {
              const initials = (m.full_name || m.email || '?')
                .split(' ')
                .map(s => s[0]?.toUpperCase())
                .join('')
                .slice(0, 2)

              return (
                <li key={m.user_id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="h-9 w-9 rounded-full bg-gray-100 border flex items-center justify-center text-xs font-semibold">
                      {initials || '–'}
                    </div>
                    {/* Tekst */}
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <span>{m.full_name || m.email || m.user_id}</span>
                        {ownerId === m.user_id && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 border">
                            Owner
                          </span>
                        )}
                        {m.role === 'admin' && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">Sinds: {safeSince(m?.since)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user_id, e.target.value)}
                      className="border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                      disabled={!canAdmin || isLastAdmin(m.user_id)}
                    >
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <button
                      onClick={() => removeMember(m.user_id)}
                      className="text-red-600 text-sm px-3 py-1.5 rounded-lg border hover:bg-red-50 disabled:opacity-50"
                      disabled={!canAdmin || isLastAdmin(m.user_id)}
                    >
                      Verwijderen
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Uitnodigen (card) */}
      <form onSubmit={sendInvite} className="rounded-2xl border p-4 bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Gebruiker uitnodigen</h3>
          <span className="text-xs text-gray-500">
            {atLimit ? `Limiet bereikt (${members.length}/${SEAT_LIMIT})` : `Beschikbaar: ${SEAT_LIMIT - members.length}`}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="email"
            required
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="email@bedrijf.nl"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={!canAdmin || atLimit}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10"
            disabled={!canAdmin || atLimit}
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
            disabled={!canAdmin || atLimit}
          >
            Uitnodigen
          </button>
        </div>

        {inviteLink && (
          <div className="bg-gray-50 border rounded-lg p-3 text-sm">
            <div className="mb-2">Uitnodigingslink (7 dagen geldig):</div>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-2 py-1" value={inviteLink} readOnly />
              <button
                type="button"
                onClick={() => copyToClipboard(inviteLink)}
                className="px-3 py-1 border rounded-lg"
              >
                Kopieer
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Openstaande uitnodigingen (card) */}
      {canAdmin && (
        <div className="rounded-2xl border p-4 bg-white shadow-sm">
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
                        className="px-3 py-1 border rounded-lg text-sm hover:bg-gray-50"
                      >
                        Kopieer link
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvite(inv.id)}
                        className="px-3 py-1 border rounded-lg text-sm text-red-600 hover:bg-red-50"
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
