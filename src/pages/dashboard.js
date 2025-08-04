import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { formatDutchDateTime } from '../lib/formatTimestamp';


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
  const [filterType, setFilterType] = useState("vandaag");
  const [customRange, setCustomRange] = useState([null, null]);
  const [minVisits, setMinVisits] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [minDuration, setMinDuration] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [openLabelMenus, setOpenLabelMenus] = useState({});
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [editLabelText, setEditLabelText] = useState("");
  const labelMenuRef = useRef(null);
  const companyRefs = useRef({});
  const columnRefs = useRef([]);
  const [companySearch, setCompanySearch] = useState("");
  const [sortOrder, setSortOrder] = useState("recent");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [mapCoords, setMapCoords] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [visitorTypeFilter, setVisitorTypeFilter] = useState([]);



  useEffect(() => {
  setGlobalSearch((router.query.search || "").toLowerCase());
}, [router.query.search]);

  
  function getRandomColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 70 + Math.random() * 10;  // 70–80%
  const lightness = 85 + Math.random() * 10;   // 85–95%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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
  .select(`
    *,
    phone,
    email,
    linkedin_url,
    facebook_url,
    instagram_url,
    twitter_url,
    meta_description,
    category
  `)
  .eq("user_id", user.id)
  .not("company_name", "is", null);

setAllLeads(allData || []);
console.log("Gelezen leads:", allData);



      const { data: labelData } = await supabase
        .from("labels")
        .select("*")
        .eq("user_id", user.id);
      setLabels(labelData || []);

      setLoading(false);

      const subscription = supabase
        .channel(`leads:user:${user.id}`)
        .on(
  "postgres_changes",
  { event: "INSERT", schema: "public", table: "leads" },
  (payload) => {
    const lead = payload.new;

    const isValidVisitor =
  lead.user_id === user.id &&
  lead.source === "tracker" &&
  !!lead.ip_address &&
  !!lead.page_url &&
  !!lead.timestamp &&
  !lead.page_url.includes(window.location.host)
;


    if (isValidVisitor) {
      setAllLeads((prev) => [lead, ...prev]);
    } else {
      console.warn("Lead genegeerd (geen echte bezoeker):", lead);
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
    setLabels([...data] || []);
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

  const toggleLabelMenu = (companyName, type) => {
  const key = `${type}:${companyName}`;
  setOpenLabelMenus((prev) => ({
    ...prev,
    [key]: !prev[key],
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
  if (customRange[0] && customRange[1]) {
    const toPlusOne = new Date(customRange[1]);
    toPlusOne.setDate(toPlusOne.getDate() + 1);
    return date >= customRange[0] && date < toPlusOne;
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

  if (visitorTypeFilter.length > 0) {
    const visits = allLeads.filter(
      (v) => v.company_name === l.company_name
    );

    const uniqueVisitors = new Set(
      visits.map((v) => v.anon_id || `onbekend-${v.id}`)
    );

    const match = visitorTypeFilter.some((type) => {
      if (type === "first") {
        return uniqueVisitors.size === 1;
      }
      if (type === "returning") {
        return uniqueVisitors.size > 1;
      }
      if (type === "highEngagement") {
        const totalDuration = visits.reduce(
          (sum, v) => sum + (v.duration_seconds || 0),
          0
        );
        const latestVisit = visits[0]?.timestamp
          ? new Date(visits[0].timestamp)
          : null;
        const now = new Date();
        const recencyDays = latestVisit
          ? (now - latestVisit) / (1000 * 60 * 60 * 24)
          : 999;

        const visitsScore = Math.min(visits.length / 10, 1);
        const durationScore = Math.min(totalDuration / 600, 1);
        const recencyScore =
          recencyDays < 1
            ? 1
            : recencyDays < 7
            ? 0.7
            : recencyDays < 30
            ? 0.4
            : 0.1;

        const leadRating = Math.round(
          (visitsScore * 0.4 + durationScore * 0.3 + recencyScore * 0.3) * 100
        );

        return leadRating >= 60;
      }
      return false;
    });

    if (!match) return false;
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

  const fullVisitMap = allLeads.reduce((acc, lead) => {
  if (!lead.company_name) return acc;
  if (!acc[lead.company_name]) acc[lead.company_name] = [];
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
  if (!selectedCompanyData) {
    setMapCoords(null);
    return;
  }

  // 🧭 Stap 1: eerst adres gebruiken
  const straat = selectedCompanyData.domain_address || "";
  const postcode = selectedCompanyData.domain_postal_code || "";
  const stad = selectedCompanyData.domain_city || "";

  const query = [straat, postcode, stad].filter(Boolean).join(", ");

  if (!query) {
    // Geen adres? Dan eventueel fallback op lat/lon
    if (selectedCompanyData.domain_lat && selectedCompanyData.domain_lon) {
      setMapCoords({
        lat: selectedCompanyData.domain_lat,
        lon: selectedCompanyData.domain_lon,
      });
    } else {
      setMapCoords(null);
    }
    return;
  }

  // 🔍 Geocode op basis van adres
  fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json`)
    .then((res) => res.json())
    .then((data) => {
      if (data && data.length > 0) {
        setMapCoords({
          lat: data[0].lat,
          lon: data[0].lon,
        });
      } else if (selectedCompanyData.domain_lat && selectedCompanyData.domain_lon) {
        // Geen geocode-resultaat → fallback op lat/lon
        setMapCoords({
          lat: selectedCompanyData.domain_lat,
          lon: selectedCompanyData.domain_lon,
        });
      } else {
        setMapCoords(null);
      }
    })
    .catch((err) => {
      console.error("Geocode error:", err);
      // Bij fout: fallback op lat/lon als beschikbaar
      if (selectedCompanyData.domain_lat && selectedCompanyData.domain_lon) {
        setMapCoords({
          lat: selectedCompanyData.domain_lat,
          lon: selectedCompanyData.domain_lon,
        });
      } else {
        setMapCoords(null);
      }
    });
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
const date = new Date(
  new Date(timestamp).toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })
);
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

const resetFilters = () => {
  setFilterType("vandaag");
  setCustomRange([null, null]);
  setLabelFilter("");
  setMinVisits("");
  setMinDuration("");
  setSortOrder("recent");
  setSelectedCompany(null);
  setGlobalSearch("");
  setVisitorTypeFilter([]);
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
  className="flex flex-col h-full overflow-y-auto bg-gray-50 border border-gray-200 p-4 shadow-md space-y-4"
  style={{ flexBasis: "250px", flexShrink: 0 }}
>


          <h2 className="text-xl font-semibold text-gray-700 mb-2">Filters</h2>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setSelectedCompany(null);
              setInitialVisitorSet(false);
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
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
  <DatePicker
    selectsRange
    startDate={customRange[0]}
    endDate={customRange[1]}
    onChange={(update) => setCustomRange(update)}
    isClearable
    placeholderText="Selecteer datumrange"
    dateFormat="dd-MM-yyyy"
    className="w-full border rounded px-3 py-2 text-sm"
    popperClassName="!z-50 custom-datepicker"
    calendarClassName="rounded-lg shadow-lg border border-gray-200"
  />
)}




          <div className="mt-6">
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-sm font-semibold text-gray-800 tracking-wide">
      Labels
    </h2>
    <button
      onClick={() => setEditingLabelId("new")}
      className="flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
    >
      <span className="text-base mr-1">＋</span> Nieuw
    </button>
  </div>

  {editingLabelId === "new" && (
    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-inner mb-4">
      <input
        type="text"
        placeholder="Labelnaam"
        value={newLabel}
        onChange={(e) => setNewLabel(e.target.value)}
        className="w-full border border-gray-300 px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={async () => {
            if (!newLabel.trim()) return;
            const { error } = await supabase.from("labels").insert({
              user_id: user.id,
              company_name: null,
              label: newLabel.trim(),
              color: getRandomColor(),
            });
            if (!error) {
              setNewLabel("");
              setEditingLabelId(null);
              refreshLabels();
            }
          }}
          className="bg-blue-600 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-blue-700 transition"
        >
          Opslaan
        </button>
        <button
          onClick={() => {
            setNewLabel("");
            setEditingLabelId(null);
          }}
          className="border border-gray-300 px-4 py-1.5 text-sm rounded-lg hover:bg-gray-100 transition"
        >
          Annuleren
        </button>
      </div>
    </div>
  )}

  <div className="flex flex-wrap gap-2 mt-2">
    {labels
      .filter((l) => !l.company_name)
      .map((label) => (
        <div
  key={label.id}
  className="flex items-center px-3 py-1.5 rounded-full shadow-sm text-xs font-medium text-black"
  style={{ backgroundColor: label.color }}
>

          <span className="mr-2">{label.label}</span>
          <button
            onClick={async () => {
              await supabase
  .from("labels")
  .delete()
  .match({
    label: label.label,
    user_id: user.id,
  });

              await refreshLabels();
            }}
            className="text-black/80 hover:text-black ml-1"
            title="Verwijder label"
          >
            ×
          </button>
        </div>
      ))}
  </div>
</div>


      
          <input
            type="number"
            placeholder="Minimaal bezoeken"
            value={minVisits}
            onChange={(e) => setMinVisits(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          />
          <input
            type="number"
            placeholder="Minimale duur (s)"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          />
          <select
  value={sortOrder}
  onChange={(e) => setSortOrder(e.target.value)}
  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
>
  <option value="recent">Sorteer op laatst bezocht</option>
  <option value="aantal">Sorteer op aantal bezoeken</option>
</select>

<div className="space-y-2">
  <label className="block text-sm font-bold text-gray-700">
    Bezoekersgedrag
  </label>
  <div className="flex flex-col gap-1">
    {[
      { value: "first", label: "Eerste keer bezocht" },
      { value: "returning", label: "Terugkerende bezoeker" },
      { value: "highEngagement", label: "Hoge betrokkenheid" },
    ].map((option) => (
      <label key={option.value} className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          value={option.value}
          checked={visitorTypeFilter.includes(option.value)}
          onChange={(e) => {
            if (e.target.checked) {
              setVisitorTypeFilter([...visitorTypeFilter, option.value]);
            } else {
              setVisitorTypeFilter(visitorTypeFilter.filter((v) => v !== option.value));
            }
          }}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700">{option.label}</span>
      </label>
    ))}
  </div>
</div>



<button
  onClick={resetFilters}
  className="w-full mt-2 bg-gray-100 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-200 transition"
>
  Reset filters
</button>

        </div>
<div
  className="w-1 cursor-col-resize bg-gray-200 hover:bg-gray-400 transition"
  onMouseDown={(e) => startResizing(e, 0)}
></div>

{/* Bedrijvenlijst */}


<div
  ref={(el) => (columnRefs.current[1] = el)}
  className="flex flex-col h-full bg-white border border-gray-200 shadow"
  style={{ flexBasis: "500px", flexShrink: 0 }}
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

      const leads = fullVisitMap[company.company_name] || [];
          const uniqueVisitorCount = new Set(
      leads.map(l => l.anon_id || `onbekend-${l.id}`)
    ).size;

      const totalDuration = leads.reduce(
        (sum, l) => sum + (l.duration_seconds || 0),
        0
      );
      const minutes = Math.floor(totalDuration / 60);
      const seconds = totalDuration % 60;

      // Bepaal laatste bezoek
const latestVisit = leads[0]?.timestamp
  ? new Date(leads[0].timestamp)
  : null;
const now = new Date();
const recencyDays = latestVisit
  ? (now - latestVisit) / (1000 * 60 * 60 * 24)
  : 999;

// Normaliseer
const visitsScore = Math.min(leads.length / 10, 1);
const durationScore = Math.min(totalDuration / 600, 1);
const recencyScore =
  recencyDays < 1
    ? 1
    : recencyDays < 7
    ? 0.7
    : recencyDays < 30
    ? 0.4
    : 0.1;

// Combineer
const leadRating = Math.round(
  (visitsScore * 0.4 +
    durationScore * 0.3 +
    recencyScore * 0.3) *
    100
);
// Kies kleur per range
let ratingColor = "#ef4444"; // standaard rood

if (leadRating >= 80) {
  ratingColor = "#22c55e"; // groen
} else if (leadRating >= 61) {
  ratingColor = "#eab308"; // geel
} else if (leadRating >= 31) {
  ratingColor = "#f97316"; // oranje
}



      new Set(leads.map(l => l.anon_id || `onbekend-${l.id}`)).size;
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
  {uniqueVisitorCount} {uniqueVisitorCount === 1 ? "bezoeker" : "bezoekers"}
</p>

              <p className="text-xs text-gray-500">
                {minutes}m {seconds}s
              </p>
              <div className="mt-3">
  <div className="w-full bg-gray-200 rounded-full h-2 relative">
    <div
      className="h-2 rounded-full"
      style={{
        width: `${leadRating}%`,
        backgroundColor: ratingColor
      }}
    ></div>
  </div>
 <div className="text-xs text-gray-500 mt-1">
  Lead score: {leadRating}/100
</div>

{company.confidence !== null && company.confidence !== undefined && (
  <div className="text-[11px] text-gray-500 mt-1">
    Confidence: {(company.confidence * 100).toFixed(0)}%
  </div>
)}

</div>
<div className="text-[10px] text-gray-400">
  {leadRating < 31 && "Laag"}
  {leadRating >= 31 && leadRating <= 60 && "Gemiddeld"}
  {leadRating >= 61 && leadRating <= 79 && "Hoog"}
  {leadRating >= 80 && "Zeer hoog"}
</div>

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

          
        </div>
      );
    })}
 <div className="flex justify-center items-center gap-2 mt-6">
  <button
    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
    disabled={currentPage === 1}
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full border shadow-sm text-sm transition ${
      currentPage === 1
        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
        : "bg-white hover:bg-gray-50 text-gray-700"
    }`}
  >
    ◀
    <span className="hidden md:inline">Vorige</span>
  </button>
  <span className="px-3 py-1.5 text-sm text-gray-600 border rounded-full bg-gray-50 shadow-sm">
    Pagina {currentPage}
  </span>
  <button
    onClick={() => setCurrentPage((prev) => prev + 1)}
    disabled={currentPage * itemsPerPage >= companies.length}
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full border shadow-sm text-sm transition ${
      currentPage * itemsPerPage >= companies.length
        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
        : "bg-white hover:bg-gray-50 text-gray-700"
    }`}
  >
    <span className="hidden md:inline">Volgende</span>
    ▶
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
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
      {selectedCompanyData && (
        <>
         <div className="mb-4 flex items-center gap-3">
  {selectedCompanyData.company_domain && (
    <img
      src={`https://img.logo.dev/${selectedCompanyData.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
      alt="logo"
      className="w-14 h-14 object-contain rounded-xl border border-gray-200 shadow"
      onError={(e) => (e.target.style.display = "none")}
    />
  )}
  <div>
    <div className="flex items-center gap-2 relative">
      <span className="font-semibold text-gray-800">
        {selectedCompanyData.company_name}
      </span>
      <div className="relative">
        <button
          onClick={() =>
            setOpenLabelMenus({
              [`detail:${selectedCompanyData.company_name}`]: true,
            })
          }
          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow transition"
        >
          <span className="text-base leading-none">+</span>
          Label toevoegen
        </button>

        {openLabelMenus[`detail:${selectedCompanyData.company_name}`] && (
          <div
            ref={labelMenuRef}
            className="absolute left-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-50"
          >
            {labels
              .filter((l) => !l.company_name)
              .map((label) => (
                <button
                  key={label.id}
                  onClick={async () => {
                    const alreadyExists = labels.find(
                      (l2) =>
                        l2.company_name === selectedCompanyData.company_name &&
                        l2.label === label.label
                    );
                    if (alreadyExists) return;

                    await supabase.from("labels").insert({
                      user_id: user.id,
                      company_name: selectedCompanyData.company_name,
                      label: label.label,
                      color: label.color,
                    });
                    refreshLabels();
                    setOpenLabelMenus({});
                  }}
                  className="w-full flex items-center justify-start text-xs px-2 py-1 mb-1 rounded hover:bg-gray-100 transition"
                  style={{ backgroundColor: label.color }}
                >
                  {label.label}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>

    {selectedCompanyData.kvk_number && (
      <div className="text-xs text-gray-500">
        KVK: {selectedCompanyData.kvk_number}
      </div>
    )}
  </div>
</div>


<div className="mb-2 flex flex-wrap gap-1">
  {labels
    .filter((l) => l.company_name === selectedCompany)
    .map((label) => (
      <span
        key={label.id}
        style={{ backgroundColor: label.color }}
        className="inline-flex items-center text-xs text-gray-700 px-2 py-0.5 rounded-full"
      >
        {label.label}
      </span>
    ))}
</div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Bedrijfsgegevens */}
           <div className="space-y-4 text-sm text-gray-700 bg-white p-6 rounded-2xl border border-gray-200 shadow-lg">
  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
    📇 Bedrijfsprofiel
  </h3>

  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {/* Adres */}
    {(selectedCompanyData.domain_address || selectedCompanyData.domain_city) && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Adres</p>
        <p className="text-gray-800 leading-snug">
          {selectedCompanyData.domain_address && <>{selectedCompanyData.domain_address}<br /></>}
          {selectedCompanyData.domain_postal_code && selectedCompanyData.domain_city && (
            <>
              {selectedCompanyData.domain_postal_code} {selectedCompanyData.domain_city}<br />
            </>
          )}
          {selectedCompanyData.domain_country && <>{selectedCompanyData.domain_country}</>}
        </p>
      </div>
    )}

    {/* Website */}
    {selectedCompanyData.company_domain && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Website</p>
        <a
          href={`https://${selectedCompanyData.company_domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline break-words"
        >
          {selectedCompanyData.company_domain}
        </a>
      </div>
    )}

    {/* Email */}
    {selectedCompanyData.email && (
      <div>
        <p className="text-xs font-semibold text-gray-600">E-mail</p>
        <a
          href={`mailto:${selectedCompanyData.email}`}
          className="text-blue-600 hover:underline break-all"
        >
          {selectedCompanyData.email}
        </a>
      </div>
    )}

    {/* Telefoon */}
    {selectedCompanyData.phone && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Telefoon</p>
        <p className="text-gray-800">{selectedCompanyData.phone}</p>
      </div>
    )}

    {/* Social links */}
    {selectedCompanyData.linkedin_url && (
      <div>
        <p className="text-xs font-semibold text-gray-600">LinkedIn</p>
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
    {selectedCompanyData.facebook_url && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Facebook</p>
        <a
          href={selectedCompanyData.facebook_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Facebook-pagina
        </a>
      </div>
    )}
    {selectedCompanyData.instagram_url && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Instagram</p>
        <a
          href={selectedCompanyData.instagram_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Instagram-profiel
        </a>
      </div>
    )}
    {selectedCompanyData.twitter_url && (
      <div>
        <p className="text-xs font-semibold text-gray-600">Twitter</p>
        <a
          href={selectedCompanyData.twitter_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Twitter-profiel
        </a>
      </div>
    )}
  </div>

  {/* Meta description */}
  {selectedCompanyData.meta_description && (
    <div className="mt-4">
      <p className="text-xs font-semibold text-gray-600">Beschrijving</p>
      <p className="text-gray-700 leading-snug whitespace-pre-wrap">
        {selectedCompanyData.meta_description}
      </p>
    </div>
  )}
</div>




            {/* OpenStreetMap */}
            <div className="w-full h-65 rounded-xl border border-gray-200 shadow overflow-hidden">
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
              className={`mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow hover:shadow-lg hover:scale-[1.02] transition-transform duration-200 ${
  isOpen ? "bg-blue-50" : ""
}`}


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
  {[...sessions].reverse().map((s, idx) => (
    <li key={s.id} className="py-3">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2">
        <div className="truncate">
          <span className="text-gray-800 text-sm">
  🔗 {s.page_url}
</span>


          {/* Toon UTM onder de oorspronkelijk eerste pagina (nu laatste in reversed lijst) */}
          {idx === sessions.length - 1 && (s.utm_source || s.utm_medium) && (
            <div className="text-xs text-gray-500 mt-1">
              🎯 via{" "}
              <span className="font-medium text-gray-700">
                {s.utm_source || "onbekend"}
              </span>
              {s.utm_medium && (
                <span className="text-gray-400"> / {s.utm_medium}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col md:flex-row md:gap-4 text-gray-500 text-xs text-right md:text-left">
{formatDutchDateTime(s.timestamp)}
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
