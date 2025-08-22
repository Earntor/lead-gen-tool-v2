// /components/LabelManager.js
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function LabelManager({ labels, companyName, orgId, refreshLabels }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Filter labels voor dit bedrijf
  const companyLabels = (labels || []).filter((l) => l.company_name === companyName);

  // Pastel kleur generator
  const getRandomPastelColor = () => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
  };

  // Nieuw label opslaan
  const handleAddLabel = async () => {
    const value = newLabel.trim();
    if (!value) return;

    // Zonder orgId blokkeert RLS → direct melden
    if (!orgId) {
      alert("Kan label niet opslaan: orgId ontbreekt (profiel nog niet geladen).");
      return;
    }

    setSaving(true);

    // Auth check
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData?.user?.id) {
      setSaving(false);
      alert("Niet ingelogd");
      return;
    }

    const { error } = await supabase.from("labels").insert({
      user_id: userData.user.id,
      org_id: orgId,              // ← BELANGRIJK voor je RLS-policies
      company_name: companyName,
      label: value,
      color: getRandomPastelColor(),
    });

    setSaving(false);

    if (error) {
      alert("Fout bij label toevoegen: " + error.message);
      console.error(error);
      return;
    }

    setNewLabel("");
    setMenuOpen(false);
    refreshLabels?.();
  };

  // Label verwijderen
  const handleDeleteLabel = async (labelId) => {
    if (!labelId) return;

    setDeletingId(labelId);
    const { error } = await supabase.from("labels").delete().eq("id", labelId);
    setDeletingId(null);

    if (error) {
      alert("Fout bij label verwijderen: " + error.message);
      console.error(error);
      return;
    }

    refreshLabels?.();
  };

  return (
    <div className="space-y-1">
      {/* Bestaande labels */}
      <div className="flex flex-wrap gap-1">
        {companyLabels.map((label) => (
          <span
            key={label.id}
            style={{ backgroundColor: label.color }}
            className="flex items-center gap-1 text-xs text-gray-700 px-2 py-0.5 rounded"
          >
            {label.label}
            <button
              onClick={() => handleDeleteLabel(label.id)}
              className="text-xs hover:text-red-600 disabled:opacity-50"
              title="Verwijderen"
              disabled={deletingId === label.id}
            >
              {deletingId === label.id ? "…" : "✕"}
            </button>
          </span>
        ))}
      </div>

      {/* Nieuw label toevoegen */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="text-xs text-blue-600 hover:underline mt-1"
        >
          + Label
        </button>

        {menuOpen && (
          <div className="mt-1 flex gap-1">
            <input
              type="text"
              placeholder="Nieuw label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="border px-2 py-1 text-xs rounded w-full"
            />
            <button
              onClick={handleAddLabel}
              className="bg-blue-600 text-white text-xs px-2 py-1 rounded disabled:opacity-50"
              disabled={saving || !newLabel.trim()}
              title={!orgId ? "orgId ontbreekt" : undefined}
            >
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
