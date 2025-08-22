// /components/labelmanager.jsx
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function LabelManager({ labels, companyName, orgId, refreshLabels }) {
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const companyLabels = (labels || []).filter((l) => l.company_name === companyName);

  const handleAdd = async () => {
    const newLabel = prompt("Voer labelnaam in:");
    if (!newLabel) return;

    if (!orgId) {
      alert("Kan label niet opslaan: orgId ontbreekt (profiel nog niet geladen).");
      return;
    }

    setAdding(true);

    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !session?.access_token) {
      setAdding(false);
      alert("Niet ingelogd");
      return;
    }

    const res = await fetch("/api/labels/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        orgId,                     // ⬅️ belangrijk voor RLS
        companyName,
        label: newLabel.trim(),
      }),
    });

    setAdding(false);

    if (!res.ok) {
      const txt = await res.text();
      alert("Fout bij label toevoegen: " + txt);
      console.error(txt);
      return;
    }

    refreshLabels?.();
  };

  const handleDelete = async (labelId) => {
    if (!labelId) return;

    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !session?.access_token) {
      alert("Niet ingelogd");
      return;
    }

    setDeletingId(labelId);

    const res = await fetch("/api/labels/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ labelId }),
    });

    setDeletingId(null);

    if (!res.ok) {
      const txt = await res.text();
      alert("Fout bij label verwijderen: " + txt);
      console.error(txt);
      return;
    }

    refreshLabels?.();
  };

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {companyLabels.map((l) => (
        <span
          key={l.id}
          className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded flex items-center"
        >
          {l.label}
          <button
            onClick={() => handleDelete(l.id)}
            className="ml-1 text-blue-500 hover:text-red-500 disabled:opacity-50"
            disabled={deletingId === l.id}
            title={deletingId === l.id ? "Verwijderen..." : "Verwijderen"}
          >
            {deletingId === l.id ? "…" : "✕"}
          </button>
        </span>
      ))}

      <button
        onClick={handleAdd}
        disabled={adding}
        className="text-xs text-blue-600 hover:underline ml-1 disabled:opacity-50"
        title={!orgId ? "orgId ontbreekt" : undefined}
      >
        {adding ? "Toevoegen…" : "+ Label"}
      </button>
    </div>
  );
}
