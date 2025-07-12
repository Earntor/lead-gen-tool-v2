import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function LabelManager({ labels, companyName, refreshLabels }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const companyLabels = labels.filter(
    (l) => l.company_name === companyName
  );

  const getRandomPastelColor = () => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
  };

  const handleAddLabel = async () => {
    if (!newLabel.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("labels").insert({
      user_id: userData.user.id,
      company_name: companyName,
      label: newLabel.trim(),
      color: getRandomPastelColor(),
    });
    if (!error) {
      setNewLabel("");
      refreshLabels();
      setMenuOpen(false);
    } else {
      console.error("Fout bij label toevoegen:", error.message);
    }
  };

  const handleDeleteLabel = async (labelId) => {
    const { error } = await supabase.from("labels").delete().eq("id", labelId);
    if (!error) {
      refreshLabels();
    } else {
      console.error("Fout bij label verwijderen:", error.message);
    }
  };

  return (
    <div className="space-y-1">
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
              className="text-xs hover:text-red-600"
              title="Verwijderen"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
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
              className="bg-blue-600 text-white text-xs px-2 py-1 rounded"
            >
              Opslaan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
