import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { formatDutchDateTime } from '../lib/formatTimestamp';
import { isToday, isYesterday, isWithinInterval, subDays } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { countryNameToCode } from "../lib/countryNameToCode";


// Skeletons loading
function FiltersSkeleton() {
  return (
    <div
      className="flex flex-col h-full overflow-y-auto bg-gray-50 border border-gray-200 p-4 shadow-md space-y-4 animate-pulse"
      style={{ flexBasis: "250px", flexShrink: 0 }}
    >
      <div className="h-5 w-1/2 bg-gray-200 rounded" />
      <div className="h-9 w-full bg-gray-200 rounded" />
      <div className="h-20 w-full bg-gray-200 rounded" />
      <div className="h-5 w-1/3 bg-gray-200 rounded" />
      <div className="h-9 w-full bg-gray-200 rounded" />
      <div className="h-9 w-full bg-gray-200 rounded" />
      <div className="h-5 w-1/3 bg-gray-200 rounded" />
      <div className="h-9 w-full bg-gray-200 rounded" />
      <div className="h-9 w-full bg-gray-200 rounded" />
      <div className="h-24 w-full bg-gray-200 rounded" />
    </div>
  );
}

function LeadCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow animate-pulse">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="h-4 w-2/5 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-1/4 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-1/2 bg-gray-200 rounded" />
        </div>
        <div className="w-24">
          <div className="h-3 w-3/4 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-2/3 bg-gray-200 rounded mb-2" />
          <div className="h-2 w-full bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col flex-grow overflow-y-auto bg-white border border-gray-200 p-4 shadow animate-pulse">
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 bg-gray-200 rounded-xl" />
          <div className="flex-1">
            <div className="h-4 w-48 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-32 bg-gray-200 rounded" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="space-y-3">
            <div className="h-4 w-24 bg-gray-200 rounded" />
            <div className="h-3 w-3/4 bg-gray-200 rounded" />
            <div className="h-3 w-2/3 bg-gray-200 rounded" />
            <div className="h-3 w-1/2 bg-gray-200 rounded" />
          </div>
          <div className="h-40 bg-gray-200 rounded-xl border" />
        </div>

        <div className="h-3 w-40 bg-gray-200 rounded mb-2" />
        <div className="h-20 w-full bg-gray-200 rounded" />
      </div>
    </div>
  );
}



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
  const [categoryFilter, setCategoryFilter] = useState("");
  const [uniqueCategories, setUniqueCategories] = useState([]);
const [openNoteFor, setOpenNoteFor] = useState(null);         // welke lead open staat
const [noteDraft, setNoteDraft] = useState('');               // tekst in textarea
const [noteUpdatedAt, setNoteUpdatedAt] = useState({});       // laatste bewerkt per domein
const [authToken, setAuthToken] = useState(null);
const [notesByDomain, setNotesByDomain] = useState({}); // { [domain]: "note text" }
const fetchedDomainsRef = useRef(new Set());            // om dubbele fetches te voorkomen
const geocodeCacheRef = useRef(new Map()); // key: adres-string → { lat, lon }
const [profile, setProfile] = useState(null);


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

const { data: sessionData } = await supabase.auth.getSession();
const token = sessionData?.session?.access_token || null;
setAuthToken(token);

// Profiel ophalen om org_id te weten
const { data: profileRow, error: profErr } = await supabase
  .from("profiles")
  .select("current_org_id")
  .eq("id", user.id)
  .single();

if (profErr || !profileRow?.current_org_id) {
  console.error("Geen current_org_id gevonden voor user:", user.id);
  setProfile(null);
  setAllLeads([]);
  setLabels([]);
  setLoading(false);
  return;
}

// ⬅️ Bewaar in state zodat 'profile' overal beschikbaar is
setProfile(profileRow);

// Gebruik dit orgId voor alle queries/subscriptions hieronder
const orgId = profileRow.current_org_id;

// Leads ophalen per organisatie
const { data: allData } = await supabase
  .from("leads")
  .select(`
    *,
    phone, email,
    linkedin_url, facebook_url, instagram_url, twitter_url,
    meta_description, category
  `)
  .eq("org_id", orgId)
  .not("company_name", "is", null);

setAllLeads(allData || []);
console.log("Gelezen leads:", allData);

const categoriesSet = new Set((allData || []).map((l) => l.category).filter(Boolean));
setUniqueCategories(Array.from(categoriesSet).sort());

// Labels per organisatie
const { data: labelData } = await supabase
  .from("labels")
  .select("*")
  .eq("org_id", orgId);

setLabels(labelData || []);
setLoading(false);

// Realtime leads (alleen deze org)
const leadsCh = supabase
  .channel(`leads:org:${orgId}`)
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "leads", filter: `org_id=eq.${orgId}` },
    (payload) => {
      const lead = payload.new;
      const isValidVisitor =
        lead.org_id === orgId &&
        lead.source === "tracker" &&
        !!lead.ip_address &&
        !!lead.page_url &&
        !!lead.timestamp &&
        !lead.page_url.includes(window.location.host);

      if (isValidVisitor) {
        setAllLeads((prev) => [lead, ...prev]);
      }
    }
  )
  .subscribe();

// Realtime labels (alleen deze org)
const labelsCh = supabase
  .channel(`labels:org:${orgId}`)
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "labels", filter: `org_id=eq.${orgId}` },
    (payload) => {
      if (payload.eventType === "INSERT") {
        setLabels((prev = []) => [...prev, payload.new]);
      } else if (payload.eventType === "UPDATE") {
        setLabels((prev = []) => prev.map((l) => (l.id === payload.new.id ? payload.new : l)));
      } else if (payload.eventType === "DELETE") {
        setLabels((prev = []) => prev.filter((l) => l.id !== payload.old.id));
      }
    }
  )
  .subscribe();

// Cleanup
return () => {
  supabase.removeChannel(leadsCh);
  supabase.removeChannel(labelsCh);
};


    };
    getData();
  }, [router]);

  // ⬇️ NIEUWE useEffect: notities ophalen zodra we een token én leads hebben
// Notities ophalen: alleen voor domeinen die we nog niet gehaald hebben.
// Let op: we updaten *niet* allLeads, maar alleen notesByDomain.
useEffect(() => {
  if (!authToken || allLeads.length === 0) return;

  // Unieke, stabiele lijst domeinen
  const domains = [...new Set(allLeads.map(l => l.company_domain).filter(Boolean))];
  if (domains.length === 0) return;

  // Filter op domeinen die we nog niet fetched hebben
  const toFetch = domains.filter(d => !fetchedDomainsRef.current.has(d));
  if (toFetch.length === 0) return;

  let cancelled = false;

  (async () => {
    try {
      const results = await Promise.all(
        toFetch.map(async (domain) => {
          try {
            const res = await fetch(`/api/lead-note?company_domain=${encodeURIComponent(domain)}`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) return [domain, null, null];
            const json = await res.json();
            return [domain, json?.note ?? '', json?.updated_at ?? null];
          } catch {
            return [domain, null, null];
          }
        })
      );

      if (cancelled) return;

      // Markeer als fetched zodat we ze niet opnieuw ophalen
      toFetch.forEach(d => fetchedDomainsRef.current.add(d));

      // Note‑map bijwerken zonder allLeads te raken
      setNotesByDomain(prev => {
        const next = { ...prev };
        results.forEach(([domain, note]) => {
          if (note !== null && note !== undefined) next[domain] = note;
        });
        return next;
      });

      // Laatst‑bewerkt timestamps vullen
      setNoteUpdatedAt(prev => {
        const next = { ...prev };
        results.forEach(([domain, , ts]) => {
          if (ts) next[domain] = ts;
        });
        return next;
      });
    } catch {
      // stil falen is oké
    }
  })();

  return () => { cancelled = true; };
}, [authToken, allLeads]);



    const refreshLabels = async () => {
  if (!profile?.current_org_id) return;
  const { data } = await supabase
    .from("labels")
    .select("*")
    .eq("org_id", profile.current_org_id);
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

  const toggleLabelMenu = (companyName, type) => {
  const key = `${type}:${companyName}`;
  setOpenLabelMenus((prev) => ({
    ...prev,
    [key]: !prev[key],
  }));
};

const isInDateRange = (dateStr) => {
  if (!dateStr) return false;

  // Zet timestamp om naar Amsterdam-tijd
  const date = utcToZonedTime(new Date(dateStr), 'Europe/Amsterdam');

  // Bepaal start van vandaag in Amsterdam
  const today = utcToZonedTime(new Date(), 'Europe/Amsterdam');
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
    const rangeStart = utcToZonedTime(new Date(customRange[0]), 'Europe/Amsterdam');
    const rangeEnd = utcToZonedTime(new Date(customRange[1]), 'Europe/Amsterdam');
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    return date >= rangeStart && date < rangeEnd;
  }
  return true;

default:
  return true;
}
};





 const filteredLeads = allLeads.filter((l) => {
if (!l.timestamp || !isInDateRange(l.timestamp)) return false;
  if (minDuration && (!l.duration_seconds || l.duration_seconds < parseInt(minDuration))) return false;
if (categoryFilter && l.category !== categoryFilter) return false;


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

        const latestVisit = visits.length > 0 && visits[0].timestamp
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

  // boven in je component: een kleine cache is handig
// const geocodeCacheRef = useRef(new Map());  // heb je deze nog niet, voeg 'm toe

useEffect(() => {
  if (!selectedCompanyData) {
    setMapCoords(null);
    return;
  }

  // Altijd geocoden op adres (géén lat/lon fallback)
  const straat   = selectedCompanyData.domain_address || '';
  const postcode = selectedCompanyData.domain_postal_code || '';
  const stad     = selectedCompanyData.domain_city || '';
  const land     = selectedCompanyData.domain_country || ''; // helpt nauwkeurigheid

  const fullQuery     = [straat, postcode, stad, land].filter(Boolean).join(', ').trim();
  const fallbackQuery = [postcode, stad, land].filter(Boolean).join(', ').trim();

  if (!fullQuery && !fallbackQuery) {
    setMapCoords(null);
    return;
  }

  // (optioneel) snelle cache
  const tryFromCache = (q) => {
    if (!q) return false;
    const hit = geocodeCacheRef.current?.get(q);
    if (hit?.lat && hit?.lon) {
      setMapCoords({ lat: hit.lat, lon: hit.lon });
      return true;
    }
    return false;
  };
  if (tryFromCache(fullQuery) || tryFromCache(fallbackQuery)) return;

  let cancelled = false;

  const doGeocode = async (q) => {
    if (!q) return null;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const json = await res.json();
      const lat = json?.lat, lon = json?.lon;
      if (lat && lon && geocodeCacheRef.current) geocodeCacheRef.current.set(q, { lat, lon });
      return lat && lon ? { lat, lon } : null;
    } catch {
      clearTimeout(t);
      return null;
    }
  };

  (async () => {
    // 1) Volledig adres
    let coords = await doGeocode(fullQuery);
    // 2) Fallback naar postcode + stad (+ land)
    if (!coords) coords = await doGeocode(fallbackQuery);

    if (!cancelled) setMapCoords(coords || null);
  })();

  return () => { cancelled = true; };
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
    new Date(lead.timestamp).toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })
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
  setCategoryFilter("");
};

  if (loading) {
  return (
    <div className="w-full">
      <div className="flex w-full h-[calc(100vh-6rem)]">
        {/* Linker kolom: Filters skeleton */}
        <FiltersSkeleton />

        {/* Resizer */}
        <div
          className="w-1 cursor-col-resize bg-gray-200"
          aria-hidden
        />

        {/* Midden kolom: lijst met 10 skeleton cards */}
        <div
          className="flex flex-col h-full bg-white border border-gray-200 shadow"
          style={{ flexBasis: "500px", flexShrink: 0 }}
        >
          <div className="bg-blue-50 border-b border-blue-200 p-3 space-y-2 animate-pulse">
            <div className="h-4 w-48 bg-blue-100 rounded" />
            <div className="h-3 w-40 bg-blue-100 rounded" />
            <div className="h-3 w-36 bg-blue-100 rounded" />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <LeadCardSkeleton key={i} />
            ))}
          </div>
        </div>

        {/* Resizer */}
        <div
          className="w-1 cursor-col-resize bg-gray-200"
          aria-hidden
        />

        {/* Rechter kolom: detail skeleton */}
        <DetailSkeleton />
      </div>
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




   {(() => {
  // ✅ labels zijn organisatie‑gebonden
  const orgId = profile?.current_org_id ?? null;

  // Veilige kleurfunctie
  const getRandomColorSafe =
    typeof getRandomColor === "function"
      ? getRandomColor
      : () => {
          const hue = Math.floor(Math.random() * 360);
          return `hsl(${hue}, 70%, 85%)`;
        };

  // OPTIMISTIC add → server → temp vervangen → géén refresh
  const handleSaveNewLabel = async () => {
  if (!newLabel?.trim()) return;

  // Zorg dat er een org actief is
  const orgId = profile?.current_org_id ?? null;
  if (!orgId) { alert("Geen actieve organisatie."); return; }

  // Check login
  const { data: { session }, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !session?.access_token) { alert("Niet ingelogd"); return; }

  // 1) Optimistic toevoegen
  const optimistic = {
    id: `temp-${Date.now()}`,
    org_id: orgId,
    company_name: null,                 // globaal label
    label: newLabel.trim(),
    color: typeof getRandomColor === "function" ? getRandomColor() : (() => {
      const hue = Math.floor(Math.random() * 360);
      return `hsl(${hue}, 70%, 85%)`;
    })(),
    inserted_at: new Date().toISOString(),
  };
  setLabels((prev) => [optimistic, ...(prev || [])]);

  try {
    // 2) DIRECTE INSERT NAAR SUPABASE (géén fetch naar /api)
    const { data: saved, error } = await supabase
      .from("labels")
      .insert({
        org_id: orgId,
        company_name: null,
        label: optimistic.label,
        color: optimistic.color,
      })
      .select("*")
      .single();

    if (error) {
      // Rollback
      setLabels((prev) => (prev || []).filter((l) => l.id !== optimistic.id));
      alert("Fout bij label toevoegen: " + (error.message || "onbekend"));
      console.error(error);
      return;
    }

    // 3) Vervang temp door server-row
    setLabels((prev) => {
      const rest = (prev || []).filter((l) => l.id !== optimistic.id);
      const withoutDup = rest.filter((l) => l.id !== saved.id);
      return [saved, ...withoutDup];
    });

    setNewLabel("");
    setEditingLabelId(null);

    // ⚠️ GEEN refreshLabels hier (replica-lag)
  } catch (e) {
    // Rollback bij netwerkfout
    setLabels((prev) => (prev || []).filter((l) => l.id !== optimistic.id));
    alert("Fout bij label toevoegen (netwerk): " + (e?.message || e));
    console.error(e);
  }
};

  // OPTIMISTIC delete → server → geen refresh
  // ⬇️ vervang je bestaande handleDeleteGlobalLabel door deze
const handleDeleteGlobalLabel = async (labelId) => {
  if (!labelId) return;

  // 1) Zoek de volledige label-rij op (we hebben 'label' en 'org_id' nodig)
  const toDelete = (labels || []).find(l => l.id === labelId);
  if (!toDelete) return;

  // Check login
  const { data: { session }, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !session?.access_token) {
    alert("Niet ingelogd");
    return;
  }

  // 2) Optimistic UI: haal zowel de globale rij als alle toewijzingen weg uit state
  const backup = [...(labels || [])];
  const sameOrg = (l) => l.org_id === toDelete.org_id;
  const sameLabel = (l) => l.label === toDelete.label;

  setLabels(prev =>
    (prev || []).filter(l => {
      // verwijder: de globale zelf ...
      if (l.id === labelId) return false;
      // ... en álle toewijzingen met zelfde org + label (company_name != null)
      if (sameOrg(l) && sameLabel(l) && l.company_name) return false;
      return true;
    })
  );

  try {
    // 3) Server: verwijder eerst ALLE toewijzingen, daarna de globale definitie
    //    (2 losse calls omdat we geen transactie hebben aan de client-kant)
    const { error: delAssignErr } = await supabase
      .from("labels")
      .delete()
      .match({ org_id: toDelete.org_id, label: toDelete.label })
      .not("company_name", "is", null); // alleen toewijzingen

    if (delAssignErr) {
      setLabels(() => backup);
      alert("Fout bij gekoppelde labels verwijderen: " + (delAssignErr.message || "onbekend"));
      console.error(delAssignErr);
      return;
    }

    const { error: delGlobalErr } = await supabase
      .from("labels")
      .delete()
      .eq("id", labelId);

    if (delGlobalErr) {
      setLabels(() => backup);
      alert("Fout bij label verwijderen: " + (delGlobalErr.message || "onbekend"));
      console.error(delGlobalErr);
      return;
    }

    // Klaar: realtime zal alles bevestigen
  } catch (e) {
    setLabels(() => backup);
    alert("Fout bij label verwijderen (netwerk): " + (e?.message || e));
    console.error(e);
  }
};


  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-800 tracking-wide">Labels</h2>
        <button
          onClick={() => setEditingLabelId("new")}
          className="flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          disabled={!orgId}
          title={!orgId ? "Wachten op organisatie…" : "Nieuw label"}
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
              onClick={handleSaveNewLabel}
              className="bg-blue-600 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-blue-700 transition"
              disabled={!orgId}
            >
              Opslaan
            </button>
            <button
              onClick={() => { setNewLabel(""); setEditingLabelId(null); }}
              className="border border-gray-300 px-4 py-1.5 text-sm rounded-lg hover:bg-gray-100 transition"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        {(labels || [])
          .filter((l) => l.org_id === orgId) // ⬅️ extra zekerheid: alleen labels van deze org
          .filter((l) => !l.company_name)    // alleen globale labels
          .map((label) => (
            <div
              key={label.id}
              className="flex items-center px-3 py-1.5 rounded-full shadow-sm text-xs font-medium text-black"
              style={{ backgroundColor: label.color }}
            >
              <span className="mr-2">{label.label}</span>
              <button
                onClick={() => handleDeleteGlobalLabel(label.id)}
                className="text-black/80 hover:text-black ml-1"
                title="Verwijder label"
              >
                ×
              </button>
            </div>
          ))}
      </div>
    </div>
  );
})()}







      
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
  value={categoryFilter}
  onChange={(e) => setCategoryFilter(e.target.value)}
  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
>
  <option value="">Alle categorieën</option>
  {uniqueCategories.map((cat) => (
    <option key={cat} value={cat}>
      {cat}
    </option>
  ))}
</select>

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

  {/* Vlag op basis van domain_country (naam → code) */}
  {company.domain_country && countryNameToCode(company.domain_country) && (
    <img
      src={`https://flagcdn.com/w20/${countryNameToCode(company.domain_country)}.png`}
      alt={company.domain_country}
      className="w-5 h-3 rounded shadow-sm"
      title={company.domain_country}
    />
  )}

  {/* Fallback: als domain_country ontbreekt, gebruik ip_country (ISO) */}
  {!company.domain_country && company.ip_country && (
    <img
      src={`https://flagcdn.com/w20/${String(company.ip_country).toLowerCase()}.png`}
      alt={company.ip_country}
      className="w-5 h-3 rounded shadow-sm"
      title={company.ip_country}
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
{company.category && (
  <p className="text-xs text-gray-500 truncate">
    🏷️ {company.category}
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

  {/* Vlag op basis van domain_country */}
  {selectedCompanyData.domain_country && countryNameToCode(selectedCompanyData.domain_country) && (
    <img
      src={`https://flagcdn.com/w20/${countryNameToCode(selectedCompanyData.domain_country)}.png`}
      alt={selectedCompanyData.domain_country}
      className="w-5 h-3 rounded shadow-sm"
      title={selectedCompanyData.domain_country}
    />
  )}

  {/* Fallback naar ip_country als domain_country ontbreekt */}
  {!selectedCompanyData.domain_country && selectedCompanyData.ip_country && (
    <img
      src={`https://flagcdn.com/w20/${String(selectedCompanyData.ip_country).toLowerCase()}.png`}
      alt={selectedCompanyData.ip_country}
      className="w-5 h-3 rounded shadow-sm"
      title={selectedCompanyData.ip_country}
    />
  )}

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
  org_id: profile.current_org_id,  // ✅ organisatie i.p.v. user
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

 {/* ─── Notitie open/klap knop ─────────────────── */}
<button
  onClick={() => {
    setOpenNoteFor(selectedCompanyData.company_domain);
    setNoteDraft(notesByDomain[selectedCompanyData.company_domain] || '');
  }}
  className="mt-4 px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100 transition"
>
  {notesByDomain[selectedCompanyData.company_domain] ? 'Notitie bewerken' : 'Notitie toevoegen'}
</button>

{notesByDomain[selectedCompanyData.company_domain] && (
  <p className="text-xs text-gray-500 mt-1 line-clamp-1">
    {notesByDomain[selectedCompanyData.company_domain]}
  </p>
)}

{/* ─────────────────────────────────────────────── */}


       {/* ─── Texteer-veld als openNoteFor gelijk is ───────────────── */}
        {openNoteFor === selectedCompanyData.company_domain && (
          <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <textarea
              rows={4}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Typ hier je notitie…"
            />
            <div className="mt-2 flex gap-2">
              <button
  onClick={async () => {
    try {
  const res = await fetch('/api/lead-note', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      company_domain: openNoteFor,
      note: noteDraft,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Opslaan mislukt: ${err.error || res.status}`);
    return;
  }

  const json = await res.json();
  const updated_at = json?.updated_at ?? null;

  // Update maps, niet allLeads
  setNotesByDomain(prev => ({ ...prev, [openNoteFor]: noteDraft }));
  setNoteUpdatedAt(prev => ({ ...prev, [openNoteFor]: updated_at }));

  setOpenNoteFor(null);
} catch (e) {
  alert(`Opslaan mislukt: ${e?.message || e}`);
}

  }}
  className="bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition"
>
  Opslaan
</button>

             <button
  onClick={async () => {
    try {
  const delRes = await fetch('/api/lead-note', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ company_domain: openNoteFor }),
  });

  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({}));
    alert(`Verwijderen mislukt: ${err.error || delRes.status}`);
    return;
  }

  // Maps opschonen
  setNotesByDomain(prev => {
    const next = { ...prev };
    delete next[openNoteFor];
    return next;
  });

  setNoteUpdatedAt(prev => {
    const next = { ...prev };
    delete next[openNoteFor];
    return next;
  });

  setOpenNoteFor(null);
} catch (e) {
  alert(`Verwijderen mislukt: ${e?.message || e}`);
}

  }}
  className="border border-gray-300 px-4 py-1.5 rounded-lg hover:bg-gray-100 transition"
>
  Verwijderen
</button>

            </div>
          </div>
        )}
        {/* ────────────────────────────────────────────────────── */}

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
    <div className="p-4 text-sm text-gray-500 flex items-center justify-center h-full">
      Geen kaart beschikbaar.
    </div>
  )}
</div>


          </div>
        </>
      )}

 {/* ─── Weergave opgeslagen notitie ─────────────── */}
       {notesByDomain[selectedCompanyData?.company_domain] && (
  <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg text-gray-700">
    <strong>
      Notitie (laatst bewerkt:{' '}
      {noteUpdatedAt[selectedCompanyData.company_domain]
        ? formatDutchDateTime(noteUpdatedAt[selectedCompanyData.company_domain])
        : '—'}
      )
    </strong>
    <p className="mt-1 italic whitespace-pre-wrap">
      {notesByDomain[selectedCompanyData.company_domain]}
    </p>
  </div>
)}
       {/* ──────────────────────────────────────────────── */}

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
