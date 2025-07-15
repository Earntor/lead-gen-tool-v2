import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useRef, useState } from "react";


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
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [editedLabelName, setEditedLabelName] = useState("");
  const labelMenuRef = useRef(null);
  const companyRefs = useRef({});
  const columnRefs = useRef([]);
  const [companySearch, setCompanySearch] = useState("");
  const [sortOrder, setSortOrder] = useState("recent");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [mapCoords, setMapCoords] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");

  useEffect(() => {
  setGlobalSearch((router.query.search || "").toLowerCase());
}, [router.query.search]);

  
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

  // Laat Layout luisteren naar dit event
  useEffect(() => {
    const handleExport = () => {
      exportLeadsToCSV(filteredLeads);
    };
    window.addEventListener("exportLeads", handleExport);
    return () => window.removeEventListener("exportLeads", handleExport);
  }, [allLeads, labels]);

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

  useEffect(() => {
    function handleClickOutside(event) {
      let clickedInsideAnyCompany = Object.values(companyRefs.current).some(
        (ref) => ref?.contains(event.target)
      );

      let clickedInsideAnyMenu = labelMenuRef.current?.contains(event.target);

      if (!clickedInsideAnyCompany && !clickedInsideAnyMenu) {
        setOpenLabelMenus({});
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openLabelMenus]);

  const toggleLabelMenu = (companyName) => {
    setOpenLabelMenus((prev) => ({
      ...prev,
      [companyName]: !prev[companyName],
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

  const activeCompanyNames = Object.keys(groupedCompanies).filter(
    (companyName) => {
      if (minVisits) {
        return groupedCompanies[companyName].length >= parseInt(minVisits);
      }
      return true;
    }
  );

  const companies = allCompanies.filter((c) =>
    activeCompanyNames.includes(c.company_name)
  );
  const selectedCompanyData = selectedCompany
  ? allCompanies.find((c) => c.company_name === selectedCompany)
  : null;

  useEffect(() => {
  if (
    selectedCompanyData &&
    selectedCompanyData.kvk_street &&
    selectedCompanyData.kvk_city
  ) {
    const query = `${selectedCompanyData.kvk_street}, ${selectedCompanyData.kvk_city}`;
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data && data.length > 0) {
          setMapCoords({
            lat: data[0].lat,
            lon: data[0].lon,
          });
        }
      })
      .catch((err) => {
        console.error("Geocode error:", err);
      });
  } else {
    setMapCoords(null); // reset als je ander bedrijf kiest
  }
}, [selectedCompanyData]);

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


  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysLeads = allLeads.filter((lead) => {
    const date = new Date(lead.timestamp);
    return date >= today;
  });
  const todaysUniqueVisitors = new Set(
    todaysLeads.map((lead) => lead.anon_id)
  );

  const startResizing = (e, index) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = columnRefs.current[index].offsetWidth;

  const handleMouseMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    const newWidth = Math.max(150, startWidth + delta);
    columnRefs.current[index].style.flexBasis = `${newWidth}px`;
  };

  const handleMouseUp = () => {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);

    // Optioneel: hier kun je eventueel breedtes opslaan in state
  };

  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
};


  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-accent"></div>
      </div>
    );
  }

return (
  <div className="w-full">
   {/*< <div className="mb-4">
      <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
    </div>*/}

    <div className="flex w-full h-[calc(100vh-6rem)]">

        <div
  ref={(el) => (columnRefs.current[0] = el)}
  className="flex flex-col h-full overflow-y-auto bg-white border border-gray-200 p-4 shadow space-y-4"
  style={{ flexBasis: "250px", flexShrink: 0 }}
>


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
            <div className="space-y-4">
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
          <div className="space-y-4">
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
<div className="space-y-1">
  {Array.from(
    new Map(
      labels
        .filter((l) => !l.company_name)
        .map((l) => [l.label, l])
    ).values()
  ).map((label) => (
    <div
      key={label.id}
      className="flex items-center justify-between bg-gray-50 border rounded px-2 py-1 text-xs"
    >
      {editingLabelId === label.id ? (
        <input
  type="text"
  value={editedLabelName}
  onChange={(e) => setEditedLabelName(e.target.value)}
  onKeyDown={async (e) => {
    if (e.key === "Enter") {
      if (!editedLabelName.trim()) {
        alert("Labelnaam mag niet leeg zijn.");
        return;
      }

      const { error } = await supabase
  .from("labels")
  .update({ label: editedLabelName.trim() })
  .eq("user_id", user.id)
  .eq("label", label.label);


      if (error) {
        console.log("Labels bijgewerkt.");
      } else {
        console.log("Labels bijgewerkt:");
        setEditingLabelId(null);
        setEditedLabelName("");
        await refreshLabels();
      }
    }
  }}
  className="border text-xs px-1 py-0.5 rounded w-full"
  autoFocus
/>

      ) : (
        <span>{label.label}</span>
      )}

      <div className="flex gap-1">
        {editingLabelId !== label.id && (
          <button
            onClick={() => {
              setEditingLabelId(label.id);
              setEditedLabelName(label.label);
            }}
            className="hover:text-blue-600"
            title="Bewerken"
          >
            ✏️
          </button>
        )}
        <button
          onClick={async () => {
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
      </div>
    </div>
  ))}
</div>

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
            type="number"
            placeholder="Minimaal bezoeken"
            value={minVisits}
            onChange={(e) => setMinVisits(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Minimale duur (s)"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <select
  value={sortOrder}
  onChange={(e) => setSortOrder(e.target.value)}
  className="w-full border rounded px-3 py-2 text-sm"
>
  <option value="recent">Sorteer op laatst bezocht</option>
  <option value="aantal">Sorteer op aantal bezoeken</option>
</select>

        </div>
<div
  className="w-1 cursor-col-resize bg-gray-200 hover:bg-gray-400 transition"
  onMouseDown={(e) => startResizing(e, 0)}
></div>

{/* Bedrijvenlijst */}


<div
  ref={(el) => (columnRefs.current[1] = el)}
  className="flex flex-col h-full bg-white border border-gray-200 shadow"
  style={{ flexBasis: "400px", flexShrink: 0 }}
>

  <div className="bg-blue-50 border-b border-blue-200 p-3 space-y-1">
  <h2 className="text-base font-semibold text-gray-800">Websitebezoekers</h2>
  <p className="text-sm text-gray-800">
    <strong>Bezoekers vandaag:</strong> {todaysLeads.length}
  </p>
  <p className="text-sm text-gray-800">
    <strong>Nieuwe bezoekers:</strong> {todaysUniqueVisitors.size}
  </p>
</div>


<div className="flex-1 overflow-y-auto p-4 space-y-4">

  {companies.length === 0 && (
    <p className="text-sm text-gray-500 col-span-full">
      Geen bezoekers binnen dit filter.
    </p>
  )}
  {companies
  .filter((c) => {
  const naam = (c.company_name || "").toLowerCase();
  const stad = (c.kvk_city || "").toLowerCase();
  const heeftPage = groupedCompanies[c.company_name]?.some((l) =>
    (l.page_url || "").toLowerCase().includes(globalSearch)
  );
  return (
    naam.includes(globalSearch) ||
    stad.includes(globalSearch) ||
    heeftPage
  );
})

  .sort((a, b) => {
    if (sortOrder === "aantal") {
      return (groupedCompanies[b.company_name]?.length || 0) - (groupedCompanies[a.company_name]?.length || 0);
    } else if (sortOrder === "recent") {
      const lastA = groupedCompanies[a.company_name]?.[0]?.timestamp || "";
      const lastB = groupedCompanies[b.company_name]?.[0]?.timestamp || "";
      return new Date(lastB) - new Date(lastA);
    }
    return 0;
  })
    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
  .map((company) => {

      const leads = groupedCompanies[company.company_name] || [];
      const totalDuration = leads.reduce(
        (sum, l) => sum + (l.duration_seconds || 0),
        0
      );
      const minutes = Math.floor(totalDuration / 60);
      const seconds = totalDuration % 60;

      return (
        <div
          key={company.company_name}
          onClick={() => {
            setSelectedCompany(company.company_name);
            setInitialVisitorSet(false);
          }}
          className={`cursor-pointer bg-white border border-gray-200 rounded-xl p-4 shadow hover:shadow-lg hover:scale-[1.02] transition-transform duration-200 ${
  selectedCompany === company.company_name
    ? "border-blue-500 ring-1 ring-blue-500 bg-blue-50"
    : ""
}`}



        >
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                {company.company_domain && (
                  <img
                    src={`https://img.logo.dev/${company.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
                    alt="logo"
                    className="w-6 h-6 object-contain rounded"
                    onError={(e) => (e.target.style.display = "none")}
                  />
                )}
                <h3 className="text-base font-semibold text-gray-800">
                  {company.company_name}
                </h3>
              </div>
              {company.kvk_city && (
                <p className="text-xs text-gray-500 mt-0.5">📍 {company.kvk_city}</p>
              )}
              {company.company_domain && (
                <p className="text-xs text-gray-500 truncate">
                  🌐 {company.company_domain}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">
  {new Set(leads.map(l => l.anon_id)).size} bezoekers
</p>

              <p className="text-xs text-gray-500">
                {minutes}m {seconds}s
              </p>
            </div>
          </div>

          {labels
            .filter((l) => l.company_name === company.company_name)
            .map((label) => (
              <span
  key={label.id}
  style={{ backgroundColor: label.color }}
  className="inline-flex items-center text-[11px] text-gray-700 px-2 py-0.5 rounded-full mt-2 mr-2"
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
                  className="hover:text-red-600 ml-1"
                  title="Verwijderen"
                >
                  ✕
                </button>
              </span>
            ))}

          <button
  onClick={(e) => {
    e.stopPropagation();
    toggleLabelMenu(company.company_name);
  }}
  className="mt-2 inline-flex items-center gap-1 text-blue-600 text-xs hover:underline"
>
  + Label
</button>


          {openLabelMenus[company.company_name] && (
            <div ref={labelMenuRef} className="mt-2 space-y-2 bg-gray-50 border rounded p-2">
              {/* Select bestaand label */}
              <select
                onChange={async (e) => {
                  const selected = e.target.value;
                  if (!selected) return;
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

              {/* Nieuw label toevoegen */}
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
      );
    })}
    <div className="flex justify-center gap-2 mt-4">
  <button
    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
    disabled={currentPage === 1}
    className={`px-3 py-1 border rounded ${
      currentPage === 1
        ? "bg-gray-200 text-gray-500 cursor-not-allowed"
        : "bg-white hover:bg-gray-50"
    }`}
  >
    Vorige
  </button>
  <span className="px-3 py-1 text-sm text-gray-700">
    Pagina {currentPage}
  </span>
  <button
    onClick={() => setCurrentPage((prev) => prev + 1)}
    disabled={currentPage * itemsPerPage >= companies.length}
    className={`px-3 py-1 border rounded ${
      currentPage * itemsPerPage >= companies.length
        ? "bg-gray-200 text-gray-500 cursor-not-allowed"
        : "bg-white hover:bg-gray-50"
    }`}
  >
    Volgende
  </button>
</div>
</div>
</div>

<div
  className="w-1 cursor-col-resize bg-gray-200 hover:bg-gray-400 transition"
  onMouseDown={(e) => startResizing(e, 1)}
></div>


<div className="flex flex-col flex-grow overflow-y-auto bg-white border border-gray-200 p-4 shadow">
  {selectedCompany ? (
    <div className="bg-white border p-4 shadow-sm">
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
  {selectedCompanyData.company_domain && (
    <div>
      <strong>Website:</strong>{" "}
      <a
        href={`https://${selectedCompanyData.company_domain}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        {selectedCompanyData.company_domain}
      </a>
    </div>
  )}
  {selectedCompanyData.linkedin_url && (
    <div>
      <strong>LinkedIn:</strong>{" "}
      <a
        href={selectedCompanyData.linkedin_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        Bekijk profiel
      </a>
    </div>
  )}
  {selectedCompanyData.kvk_number && (
    <div>
      <strong>KVK:</strong> {selectedCompanyData.kvk_number}
    </div>
  )}
 </div>


            {/* OpenStreetMap */}
            <div className="w-full h-48 rounded border overflow-hidden">
  {mapCoords ? (
    <iframe
      title="Locatie kaart"
      width="100%"
      height="100%"
      style={{ border: 0 }}
      loading="lazy"
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(mapCoords.lon) - 0.01},${parseFloat(mapCoords.lat) - 0.01},${parseFloat(mapCoords.lon) + 0.01},${parseFloat(mapCoords.lat) + 0.01}&marker=${mapCoords.lat},${mapCoords.lon}`}
    />
  ) : (
    <p className="text-sm text-gray-500 p-2">Locatie wordt geladen...</p>
  )}
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
                  <ul className="divide-y divide-gray-200 text-sm">
  {sessions.map((s, idx) => (
    <li key={s.id} className="py-3">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2">
        <div className="truncate">
          <span className="text-gray-800">{s.page_url}</span>
          {idx === 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-xs text-blue-700">
              laatste bekeken pagina
            </span>
          )}
        </div>
        <div className="flex flex-col md:flex-row md:gap-4 text-gray-500 text-xs">
          <span>{new Date(s.timestamp).toLocaleString()}</span>
          <span>{s.duration_seconds ?? "-"} sec</span>
        </div>
      </div>
    </li>
  ))}
</ul>


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
