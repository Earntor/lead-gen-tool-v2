// /components/labelmanager.jsx
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function LabelManager({ labels, companyName, orgId, refreshLabels, setLabels }) {
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const companyLabels = (labels || []).filter((l) => l.company_name === companyName);

  const handleAdd = async () => {
    const name = prompt("Voer labelnaam in:");
    const clean = (name || "").trim();
    if (!clean) return;

    if (!orgId) {
      alert("Kan label niet opslaan: orgId ontbreekt (profiel nog niet geladen).");
      return;
    }

    // 1) Optimistic: maak een tijdelijke label (client-only)
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      org_id: orgId,
      company_name: companyName,
      label: clean,
      color: genPastel(),
      created_at: new Date().toISOString(),
    };
    setLabels?.((prev) => [optimistic, ...(prev || [])]);

    // 2) Server call
    setAdding(true);
    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !session?.access_token) {
      setAdding(false);
      // rollback optimistic
      setLabels?.((prev) => (prev || []).filter((l) => l.id !== tempId));
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
        companyName,
        label: clean,
        // kleur liever server-side laten genereren? Voor nu meesturen.
        color: optimistic.color,
      }),
    });

    setAdding(false);

    if (!res.ok) {
      const txt = await res.text();
      // rollback optimistic
      setLabels?.((prev) => (prev || []).filter((l) => l.id !== tempId));
      alert("Fout bij label toevoegen: " + txt);
      console.error(txt);
      return;
    }

    const saved = await res.json();
    // 3) Vervang temp door echte rij (met echte id)
    setLabels?.((prev) => {
      const rest = (prev || []).filter((l) => l.id !== tempId);
      return [saved, ...rest];
    });

    // 4) Eventueel nog een “echte” refresh om server de bron te maken
    await refreshLabels?.();
  };

  const handleDelete = async (labelId) => {
    if (!labelId) return;

    // optimistic remove
    const backup = labels || [];
    setLabels?.((prev) => (prev || []).filter((l) => l.id !== labelId));

    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !session?.access_token) {
      // rollback
      setLabels?.(() => backup);
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
      // rollback
      setLabels?.(() => backup);
      alert("Fout bij label verwijderen: " + txt);
      console.error(txt);
      return;
    }

    // Optioneel: refresh voor server truth
    await refreshLabels?.();
  };

  function genPastel() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {companyLabels.map((l) => (
        <span
          key={l.id}
          className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded flex items-center"
          style={{ backgroundColor: l.color || undefined }}
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
