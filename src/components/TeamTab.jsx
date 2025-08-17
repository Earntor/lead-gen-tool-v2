// components/TeamTab.jsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Gebruiker' },
  { value: 'viewer', label: 'Viewer' },
];

export default function TeamTab() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState('');
  const [orgName, setOrgName] = useState('');
  const [savingName, setSavingName] = useState(false);

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  async function loadMembers() {
    setLoading(true);
    const token = await getToken();
    if (!token) return;
    const res = await fetch('/api/org/members', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (res.ok) setMembers(json.members || []);
    setLoading(false);
  }

  useEffect(() => { loadMembers(); }, []);

  async function sendInvite(e) {
    e.preventDefault();
    setInviteLink('');
    const token = await getToken();
    if (!token) return;

    const res = await fetch('/api/org/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json?.error || 'Kon uitnodiging niet versturen');
      return;
    }
    setInviteLink(json.inviteUrl);
    setInviteEmail('');
    setInviteRole('member');
  }

  async function changeRole(user_id, role) {
    const token = await getToken();
    const res = await fetch('/api/org/members', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_user_id: user_id, role }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json?.error || 'Rol wijzigen mislukt');
    loadMembers();
  }

  async function removeMember(user_id) {
    if (!confirm('Weet je zeker dat je dit lid wilt verwijderen?')) return;
    const token = await getToken();
    const res = await fetch('/api/org/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_user_id: user_id }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json?.error || 'Verwijderen mislukt');
    loadMembers();
  }

  async function saveOrgName(e) {
    e.preventDefault();
    setSavingName(true);
    const token = await getToken();
    const res = await fetch('/api/org/update-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: orgName }),
    });
    const json = await res.json();
    setSavingName(false);
    if (!res.ok) return alert(json?.error || 'Opslaan mislukt');
    alert('Naam opgeslagen');
  }

  return (
    <div className="space-y-6">
      {/* Org-naam wijzigen (alleen zichtbaar laten via conditionele rendering als je de rol weet) */}
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
            className="px-4 py-2 rounded bg-black text-white"
            disabled={savingName || !orgName.trim()}
          >
            {savingName ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">Alleen Admin kan de naam wijzigen.</p>
      </form>

      {/* Ledenlijst */}
      <div className="p-4 border rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Teamleden</h3>
          <button
            onClick={loadMembers}
            className="text-sm underline"
          >Vernieuwen</button>
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
                  <div className="text-xs text-gray-500">Sinds: {new Date(m.since).toLocaleString('nl-NL')}</div>
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
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="px-3 py-1 border rounded"
              >
                Kopieer
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
