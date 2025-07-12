import { useState } from "react";

export default function LabelManager({ labels, companyName, refreshLabels }) {
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const newLabel = prompt("Voer labelnaam in:");
    if (!newLabel) return;
    setAdding(true);
    await fetch("/api/labels/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, label: newLabel })
    });
    setAdding(false);
    refreshLabels();
  };

  const handleDelete = async (labelId) => {
    await fetch("/api/labels/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId })
    });
    refreshLabels();
  };

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {labels
        .filter((l) => l.company_name === companyName)
        .map((l) => (
          <span
            key={l.id}
            className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded flex items-center"
          >
            {l.label}
            <button
              onClick={() => handleDelete(l.id)}
              className="ml-1 text-blue-500 hover:text-red-500"
            >
              ✕
            </button>
          </span>
        ))}
      <button
        onClick={handleAdd}
        disabled={adding}
        className="text-xs text-blue-600 hover:underline ml-1"
      >
        + Label
      </button>
    </div>
  );
}
