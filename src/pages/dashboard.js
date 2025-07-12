import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import LabelManager from "@/components/LabelManager";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [allLeads, setAllLeads] = useState([]);
  const [labels, setLabels] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openVisitors, setOpenVisitors] = useState(new Set());
  const [initialVisitorSet, setInitialVisitorSet] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [filterType, setFilterType] = useState("alles");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [minVisits, setMinVisits] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [minDuration, setMinDuration] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [openLabelMenus, setOpenLabelMenus] = useState({});

  function getRandomPastelColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
  }

  function exportLeadsToCSV(leads) {
    if (!leads || leads.length === 0) {
      alert("Geen leads om te exporteren.");
      return;
    }
    const headers = Object.keys(leads[0]);
    const csvRows = [headers.join(",")];
    for (const lead of leads) {
      const values = headers.map((header) => {
        const val = lead[header];
        return `"${val !== null && val !== undefined ? String(val).replace(/"/g, '""') : ""}"`;
      });
      csvRows.push(values.join(","));
    }
    const csvData = csvRows.join("\n");
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("hidden", "");
    a.setAttribute("href", url);
    a.setAttribute("download", "leads_export.csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  useEffect(() => {
    const getData = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!user || error) {
        router.replace("/login");
        return;
      }
      setUser(user);

      const { data: allData } = await supabase
        .from("leads")
        .select("*")
        .eq("user_id", user.id)
        .not("company_name", "is", null);
      setAllLeads(allData || []);

      const { data: labelData } = await supabase
        .from("labels")
        .select("*")
        .eq("user_id", user.id);
      setLabels(labelData || []);

      setLoading(false);

      const subscription = supabase
        .channel("public:leads")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "leads" },
          (payload) => {
            if (payload.new.user_id === user.id) {
              setAllLeads((prev) => [payload.new, ...prev]);
            }
          }
        )
        .subscribe();
      return () => {
        supabase.removeChannel(subscription);
      };
    };
    getData();
  }, [router]);

  const refreshLabels = async () => {
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("user_id", user.id);
    setLabels(data || []);
  };

  const toggleVisitor = (visitorId) => {
  setOpenVisitors((prev) => {
    const newSet = new Set(prev);
    if (newSet.has(visitorId)) {
      newSet.delete(visitorId);
    } else {
      newSet.add(visitorId);
    }
    return newSet;
  });
};


  const toggleLabelMenu = (companyName) => {
  setOpenLabelMenus((prev) => ({
    ...prev,
    [companyName]: !prev[companyName]
  }));
};

  const isInDateRange = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    switch (filterType) {
      case "vandaag":
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        return date >= today && date < tomorrow;
      case "gisteren":
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        return date >= yesterday && date < today;
      case "deze-week":
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        return date >= weekStart && date < weekEnd;
      case "vorige-week":
        const prevWeekStart = new Date(today);
        prevWeekStart.setDate(today.getDate() - today.getDay() - 7);
        const prevWeekEnd = new Date(prevWeekStart);
        prevWeekEnd.setDate(prevWeekStart.getDate() + 7);
        return date >= prevWeekStart && date < prevWeekEnd;
      case "vorige-maand":
        const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const firstPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return date >= firstPrevMonth && date < firstThisMonth;
      case "dit-jaar":
        const janFirst = new Date(today.getFullYear(), 0, 1);
        const nextYear = new Date(today.getFullYear() + 1, 0, 1);
        return date >= janFirst && date < nextYear;
      case "aangepast":
        if (customRange.from && customRange.to) {
          const from = new Date(customRange.from);
          const to = new Date(customRange.to);
          to.setDate(to.getDate() + 1);
          return date >= from && date < to;
        }
        return true;
      default:
        return true;
    }
  };

  const filteredLeads = allLeads.filter((l) => {
    if (!isInDateRange(l.timestamp)) return false;
    if (locationSearch && !(l.location?.toLowerCase() ?? "").includes(locationSearch.toLowerCase())) return false;
    if (pageSearch && !(l.page_url?.toLowerCase() ?? "").includes(pageSearch.toLowerCase())) return false;
    if (minDuration && (!l.duration_seconds || l.duration_seconds < parseInt(minDuration))) return false;
    if (labelFilter) {
      const hasLabel = labels.find(
        (lab) => lab.company_name === l.company_name && lab.label === labelFilter
      );
      if (!hasLabel) return false;
    }
    return true;
  });

  const allCompanies = [
    ...new Map(allLeads.map((lead) => [lead.company_name, lead])).values(),
  ];

  const groupedCompanies = filteredLeads.reduce((acc, lead) => {
    acc[lead.company_name] = acc[lead.company_name] || [];
    acc[lead.company_name].push(lead);
    return acc;
  }, {});

  const activeCompanyNames = Object.keys(groupedCompanies).filter((companyName) => {
    if (minVisits) {
      return groupedCompanies[companyName].length >= parseInt(minVisits);
    }
    return true;
  });

  const companies = allCompanies.filter((c) =>
    activeCompanyNames.includes(c.company_name)
  );
  const selectedCompanyData = selectedCompany
  ? allCompanies.find((c) => c.company_name === selectedCompany)
  : null;

  const filteredActivities = filteredLeads.filter(
    (l) => l.company_name === selectedCompany
  );

  const groupedByVisitor = filteredActivities.reduce((acc, activity) => {
    const key = activity.anon_id || `onbekend-${activity.id}`;
    acc[key] = acc[key] || [];
    acc[key].push(activity);
    return acc;
  }, {});

  const sortedVisitors = Object.entries(groupedByVisitor).sort((a, b) => {
    const lastA = new Date(a[1][0].timestamp);
    const lastB = new Date(b[1][0].timestamp);
    return lastB - lastA;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-accent"></div>
      </div>
    );
  }


  return (
    <div className="w-full max-w-none mx-auto px-4 py-10 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
        <button
          onClick={() => exportLeadsToCSV(filteredLeads)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition"
        >
          📁 Exporteer CSV
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="bg-white border p-4 rounded-xl shadow-sm space-y-4 md:col-span-2">
          <h2 className="text-lg font-semibold text-gray-800">Filters</h2>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setSelectedCompany(null);
              setInitialVisitorSet(false);
            }}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="alles">Alles</option>
            <option value="vandaag">Vandaag</option>
            <option value="gisteren">Gisteren</option>
            <option value="deze-week">Deze week</option>
            <option value="vorige-week">Vorige week</option>
            <option value="vorige-maand">Vorige maand</option>
            <option value="dit-jaar">Dit jaar</option>
            <option value="aangepast">Aangepast</option>
          </select>
          {filterType === "aangepast" && (
            <div className="space-y-2">
              <input
                type="date"
                value={customRange.from}
                onChange={(e) =>
                  setCustomRange((prev) => ({ ...prev, from: e.target.value }))
                }
                className="w-full"
              />
              <input
                type="date"
                value={customRange.to}
                onChange={(e) =>
                  setCustomRange((prev) => ({ ...prev, to: e.target.value }))
                }
                className="w-full"
              />
            </div>
          )}
          <div className="space-y-2">
  <select
    value={labelFilter}
    onChange={(e) => setLabelFilter(e.target.value)}
    className="w-full border rounded px-3 py-2 text-sm"
  >
    <option value="">Alle labels</option>
    {Array.from(new Set(labels.map((l) => l.label))).map((label) => (
      <option key={label} value={label}>
        {label}
      </option>
    ))}
  </select>
  <div className="flex">
    <input
      type="text"
      placeholder="Nieuw label toevoegen"
      value={newLabel}
      onChange={(e) => setNewLabel(e.target.value)}
      className="border px-2 py-1 text-sm rounded-l w-full"
    />
    <button
      onClick={async () => {
        if (!newLabel.trim()) return;
        const { error } = await supabase.from("labels").insert({
          user_id: user.id,
          company_name: null,
          label: newLabel.trim(),
          color: getRandomPastelColor(),
        });
        if (error) {
          console.error("Label toevoegen mislukt:", error.message);
        } else {
          setNewLabel("");
          refreshLabels();
        }
      }}
      className="bg-blue-600 text-white px-3 rounded-r text-sm"
    >
      +
    </button>
  </div>
</div>

          <input
            type="text"
            placeholder="Zoek land/stad"
            value={locationSearch}
            onChange={(e) => setLocationSearch(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Minimaal bezoeken"
            value={minVisits}
            onChange={(e) => setMinVisits(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Zoek pagina"
            value={pageSearch}
            onChange={(e) => setPageSearch(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Minimale duur (s)"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>

          {/* Bedrijvenlijst */}
        <div className="bg-white border p-4 rounded-xl shadow-sm space-y-2 md:col-span-3">
          <h2 className="text-lg font-semibold text-gray-800">Bedrijven</h2>
          {companies.length === 0 && (
            <p className="text-sm text-gray-500">Geen bezoekers binnen dit filter.</p>
          )}
          {companies
            .filter((c) =>
              c.company_name.toLowerCase().includes(searchTerm.toLowerCase())
            )
            .map((company) => (
              <div
                key={company.company_name}
                onClick={() => {
                  setSelectedCompany(company.company_name);
                  setInitialVisitorSet(false);
                }}
                className={`cursor-pointer flex flex-col gap-1 px-3 py-2 rounded ${
                  selectedCompany === company.company_name
                    ? "bg-blue-100 text-blue-700 font-semibold"
                    : "hover:bg-gray-100"
                }`}
              >
                <div className="flex gap-2">
  {company.company_domain && (
    <img
      src={`https://img.logo.dev/${company.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
      alt="logo"
      className="w-5 h-5 object-contain rounded-sm"
      onError={(e) => (e.target.style.display = "none")}
    />
  )}
  <div className="flex flex-col">
    <span>{company.company_name}</span>
    <div className="flex flex-wrap gap-1 mt-1">
      {labels
        .filter((l) => l.company_name === company.company_name)
        .map((label) => (
          <span
            key={label.id}
            style={{ backgroundColor: label.color }}
            className="flex items-center gap-1 text-xs text-gray-700 px-2 py-0.5 rounded"
          >
            {label.label}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const { error } = await supabase
                  .from("labels")
                  .delete()
                  .eq("id", label.id);
                if (error) {
                  console.error("Label verwijderen mislukt:", error.message);
                } else {
                  refreshLabels();
                }
              }}
              className="hover:text-red-600"
              title="Verwijderen"
            >
              ✕
            </button>
          </span>
        ))}
    </div>
  </div>
</div>

<div className="mt-1">
  <button
    onClick={() => toggleLabelMenu(company.company_name)}
    className="text-blue-600 text-sm hover:underline"
  >
    + Label
  </button>

  {openLabelMenus[company.company_name] && (
    <div className="mt-2 space-y-2 bg-gray-50 border rounded p-2">
      <select
        onChange={async (e) => {
  const selected = e.target.value;
  if (!selected) return;

  // Check of het label al gekoppeld is
  const alreadyExists = labels.find(
    (l) =>
      l.company_name === company.company_name &&
      l.label === selected
  );

  if (alreadyExists) {
    alert("Dit label is al gekoppeld aan dit bedrijf.");
    return;
  }

  const { error } = await supabase.from("labels").insert({
    user_id: user.id,
    company_name: company.company_name,
    label: selected,
    color: getRandomPastelColor(),
  });
  if (error) {
    console.error("Label koppelen mislukt:", error.message);
  } else {
    refreshLabels();
  }
}}


        defaultValue=""
        className="w-full border rounded px-2 py-1 text-sm"
      >
        <option value="" disabled>
          Kies bestaand label
        </option>
        {Array.from(new Set(labels.map((l) => l.label))).map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>

      <div className="flex">
        <input
          type="text"
          placeholder="Nieuw label"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="border px-2 py-1 text-sm rounded-l w-full"
        />
        <button
          onClick={async () => {
  const trimmed = newLabel.trim();
  if (!trimmed) return;

  const alreadyExists = labels.find(
    (l) =>
      l.company_name === company.company_name &&
      l.label === trimmed
  );

  if (alreadyExists) {
    alert("Dit label is al gekoppeld aan dit bedrijf.");
    return;
  }

  const { error } = await supabase.from("labels").insert({
    user_id: user.id,
    company_name: company.company_name,
    label: trimmed,
    color: getRandomPastelColor(),
  });
  if (error) {
    console.error("Label toevoegen mislukt:", error.message);
  } else {
    setNewLabel("");
    refreshLabels();
  }
}}

          className="bg-blue-600 text-white px-3 rounded-r text-sm"
        >
          +
        </button>
      </div>
    </div>
  )}
</div>
              </div>
            ))}
        </div>

<div className="space-y-4 md:col-span-7">
  {selectedCompany ? (
    <div className="bg-white border p-4 rounded-xl shadow-sm">
      {selectedCompanyData && (
        <>
          <div className="mb-4 flex items-center gap-3">
            {selectedCompanyData.company_domain && (
              <img
                src={`https://img.logo.dev/${selectedCompanyData.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
                alt="logo"
                className="w-8 h-8 object-contain rounded border"
                onError={(e) => (e.target.style.display = "none")}
              />
            )}
            <div>
              <div className="font-semibold text-gray-800">
                {selectedCompanyData.company_name}
              </div>
              {selectedCompanyData.linkedin_url && (
                <a
                  href={selectedCompanyData.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 text-sm hover:underline"
                >
                  LinkedIn-profiel
                </a>
              )}
              {selectedCompanyData.kvk_number && (
                <div className="text-xs text-gray-500">
                  KVK: {selectedCompanyData.kvk_number}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Bedrijfsgegevens */}
            <div className="space-y-1 text-sm text-gray-700">
              {selectedCompanyData.company_domain && (
                <div>
                  <strong>Domein:</strong> {selectedCompanyData.company_domain}
                </div>
              )}
              {selectedCompanyData.kvk_street && (
                <div>
                  <strong>Straat:</strong> {selectedCompanyData.kvk_street}
                </div>
              )}
              {selectedCompanyData.kvk_postal_code && (
                <div>
                  <strong>Postcode:</strong> {selectedCompanyData.kvk_postal_code}
                </div>
              )}
              {selectedCompanyData.kvk_city && (
                <div>
                  <strong>Stad:</strong> {selectedCompanyData.kvk_city}
                </div>
              )}
            </div>

            {/* OpenStreetMap */}
            <div className="w-full h-48 rounded border overflow-hidden">
              <iframe
                title="Locatie kaart"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                src={
                  selectedCompanyData.kvk_street
                    ? `https://www.openstreetmap.org/export/embed.html?search=${encodeURIComponent(
                        `${selectedCompanyData.kvk_street}, ${selectedCompanyData.kvk_postal_code} ${selectedCompanyData.kvk_city}`
                      )}`
                    : `https://www.openstreetmap.org/export/embed.html?bbox=3.2,50.7,7.2,53.6&layer=mapnik`
                }
              />
            </div>
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold text-gray-800 mb-2">
        Activiteiten – {selectedCompany}
      </h2>

      {sortedVisitors.length === 0 ? (
        <p className="text-sm text-gray-500">Geen activiteiten gevonden.</p>
      ) : (
        sortedVisitors.map(([visitorId, sessions], index) => {
          const isOpen = openVisitors.has(visitorId);
          return (
            <div
              key={visitorId}
              className="rounded-lg border bg-gray-50 p-4 mb-4 shadow-sm"
            >
              <button
                onClick={() => toggleVisitor(visitorId)}
                className="flex justify-between w-full text-left font-medium text-gray-800 text-sm"
              >
                Bezoeker {index + 1}
                <span>{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="mt-3 space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="bg-white border rounded p-3 text-sm shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4"
                    >
                      <div className="truncate">
                        <strong>Pagina:</strong> {s.page_url}
                      </div>
                      <div>
                        <strong>Tijdstip:</strong>{" "}
                        {new Date(s.timestamp).toLocaleString()}
                      </div>
                      <div>
                        <strong>Duur:</strong> {s.duration_seconds ?? "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  ) : (
    <div className="bg-white border p-4 rounded text-gray-500">
      Selecteer een bedrijf om activiteiten te bekijken.
    </div>
  )}
</div>


      </div>
    </div>
  );
}
