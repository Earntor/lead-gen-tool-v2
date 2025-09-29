import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useRef, useState, useMemo } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { formatDutchDateTime } from '../lib/formatTimestamp';
import { isToday, isYesterday, isWithinInterval, subDays } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { countryNameToCode } from "../lib/countryNameToCode";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";


// Normaliseer landcode voor FlagCDN: twee letters, lowercase, met uitzonderingen.
// ⛔️ Alleen domain_country gebruiken (géén ip_country fallback)
function getFlagCodeFromLead(lead) {
  if (!lead?.domain_country) return null;

  let code = null;
  try {
    // jouw robuuste mapping uit lib/countryNameToCode.js
    code = countryNameToCode(lead.domain_country);
  } catch {}

  // fallback: als helper niets geeft, gebruik raw waarde
  if (!code) code = String(lead.domain_country || "").trim();

  // normaliseer
  code = code.toLowerCase();
  if (code === "uk") code = "gb"; // FlagCDN gebruikt gb
  if (code === "el") code = "gr"; // el → gr

  // Alleen geldige ISO2 codes toestaan
  if (!/^[a-z]{2}$/.test(code)) return null;

  return code;
}

// === Bron-bepaling helpers ===============================================

// Veilig hostnaam uit een URL halen
function safeHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

// Querystring -> object
function parseQuery(url) {
  try {
    const u = new URL(url);
    const q = {};
    u.searchParams.forEach((v, k) => (q[k.toLowerCase()] = v));
    return q;
  } catch {
    return {};
  }
}

// Is referrer intern (zelfde host als page_url)?
function isInternalReferrer(referrer, pageUrl) {
  const refHost = safeHost(referrer);
  const pageHost = safeHost(pageUrl);
  if (!refHost || !pageHost) return false;
  return refHost === pageHost;
}

// Kanaal uit UTM (first-touch: UTM wint)
function channelFromUtm(utm_source = '', utm_medium = '') {
  const src = (utm_source || '').toLowerCase();
  const med = (utm_medium || '').toLowerCase();

  const has = (re) => re.test(med) || re.test(src);

  if (has(/cpc|ppc|paidsearch|sem|ads|adwords|googleads|msads/)) return 'Paid Search';
  if (has(/display|banner|gdn|programmatic/)) return 'Display';
  if (has(/email|newsletter/)) return 'Email';
  if (has(/paid.?social|paidsocial|sponsored/)) return 'Paid Social';
  if (has(/social/) && !has(/paid/)) return 'Organic Social';
  if (has(/affiliate|partner/)) return 'Affiliate';
  if (has(/referral/)) return 'Referral';
  if (has(/organic|seo/)) return 'Organic Search';

  return 'Other (UTM)';
}

// Kanaal uit referrer host
function channelFromReferrerHost(host = '') {
  const h = (host || '').toLowerCase();

  // Search engines
  if (/(^|\.)google\./.test(h)
   || /(^|\.)bing\./.test(h)
   || /(^|\.)duckduckgo\./.test(h)
   || /(^|\.)yahoo\./.test(h)
   || /(^|\.)ecosia\./.test(h)
   || /(^|\.)yandex\./.test(h)) {
    return 'Organic Search';
  }

  // Social (zonder UTM aannemen: organic)
  if (/(^|\.)facebook\.com$/.test(h)
   || /(^|\.)instagram\.com$/.test(h)
   || /(^|\.)linkedin\.com$/.test(h)
   || /(^|\.)x\.com$/.test(h)
   || /(^|\.)twitter\.com$/.test(h)
   || /(^|\.)t\.co$/.test(h)
   || /(^|\.)pinterest\./.test(h)
   || /(^|\.)tiktok\.com$/.test(h)
   || /(^|\.)reddit\.com$/.test(h)
   || /(^|\.)youtube\.com$/.test(h)) {
    return 'Social';
  }

  return 'Referral';
}

// Click-id heuristiek (als er geen UTM en geen bruikbare referrer is)
function channelFromClickId(q = {}) {
  if (q.gclid || q.gbraid || q.wbraid) return 'Paid Search';      // Google Ads
  if (q.msclkid) return 'Paid Search';                             // Microsoft Ads
  if (q.fbclid || q.ttclid || q.igshid) return 'Paid Social';      // Meta/TikTok/IG
  return null;
}

// Bepaalt de bron van de EERSTE sessie van deze bezoeker
function deriveVisitorSource(sessions = []) {
  if (!sessions || sessions.length === 0) return 'Direct';

  // Sorteer oplopend op tijd (oudste eerst)
  const sortedAsc = [...sessions].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  const first = sortedAsc[0];

  const utm_source = first.utm_source || '';
  const utm_medium = first.utm_medium || '';
  const utm_campaign = first.utm_campaign || '';
  const referrer = first.referrer || '';
  const pageUrl = first.page_url || '';

  // 1) UTM wint altijd (mits gevuld)
  if (utm_source || utm_medium) {
    const channel = channelFromUtm(utm_source, utm_medium);
    const detail = `${utm_source || 'onbekend'}/${utm_medium || 'onbekend'}${
      utm_campaign ? ` (${utm_campaign})` : ''
    }`;
    return `🎯 Bron: ${channel} / ${detail}`;
  }

  // 2) Referrer (extern)
  const refHost = safeHost(referrer);
  if (refHost && !isInternalReferrer(referrer, pageUrl)) {
    const channel = channelFromReferrerHost(refHost);
    return `🎯 Bron: ${channel} / ${refHost}`;
  }

  // 3) Click-IDs in de landings-URL
  const q = parseQuery(pageUrl);
  const clickChannel = channelFromClickId(q);
  if (clickChannel) {
    const idKey = Object.keys(q).find((k) =>
      ['gclid','gbraid','wbraid','msclkid','fbclid','ttclid','igshid'].includes(k)
    );
    return `🎯 Bron: ${clickChannel} / ${idKey || 'click-id'}`;
  }

  // 4) Anders direct
  return '🎯 Bron: Direct';
}


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

// Kleine helper: promise met timeout/fallback, zodat UI niet blijft wachten
function withTimeout(promise, ms = 8000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// === Realtime helpers voor nieuwe bedrijven ===
const CONFIDENCE_MIN = null; // pas aan naar wens

function getConfidence(lead) {
  const c = lead?.confidence;
  const a = lead?.auto_confidence;
  if (c != null) return Number(c);
  if (a != null) return Number(a);
  return null;
}

// Korte 'ping' zonder assets
async function pingSound(enabled) {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch {}
}

// Compacte knop boven de cards
function NewCompaniesButton({ count, onApply }) {
  if (!count || count <= 0) return null;
  return (
    <div className="sticky top-0 z-20 mb-3">
      <div className="mx-auto px-2">
        <div className="flex items-center justify-between rounded-xl border border-blue-500 bg-blue-50 px-3 py-2 shadow-sm">
          <button
            onClick={onApply}
            className="text-sm font-semibold text-blue-800 hover:underline"
            aria-label={`${count} nieuwe bedrijven tonen`}
            title="Klik om de nieuwe bedrijven bovenaan te tonen"
          >
            {count} nieuwe {count === 1 ? 'bezoeker' : 'bezoekers'}!
          </button>
        </div>
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
const geocodeCacheRef = useRef(new Map()); // key: adres-string → { lat, lon }
const [profile, setProfile] = useState(null);
// Sessie-start: alleen events vanaf dit moment tellen
const sessionStartRef = useRef(new Date().toISOString());

// Buffer: nieuwe bedrijven die nog niet zijn toegepast (Map: domain -> lead)
const [pendingByDomain, setPendingByDomain] = useState(() => new Map());

// Geluid: uit profiel-voorkeuren (default true; zetten we in run() correct)
const [soundOn, setSoundOn] = useState(true);

// ❇️ Tijdelijke overrides voor bedrijven buiten de huidige filters
const [overrideDomains, setOverrideDomains] = useState(new Set());


const overrideDomainsRef = useRef(new Set());
const [pulseDomains, setPulseDomains] = useState(new Set());

useEffect(() => { overrideDomainsRef.current = overrideDomains; }, [overrideDomains]);


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
  let cancelled = false;
  const run = async () => {
    // 1) Sessie + user ophalen
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user || null;
    if (!user) {
      if (!cancelled) router.replace('/login');
      return;
    }
    if (!cancelled) setUser(user);

    // 2) Sessie-token (voor API calls elders)
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token || null;
    if (!cancelled) setAuthToken(token);

    // 3) Profiel (org) + alvast in parallel starten
    const profileP = supabase
      .from('profiles')
      .select('current_org_id, preferences')
      .eq('id', user.id)
      .single();

    let profileRow = null;
    try {
      const { data: pr } = await withTimeout(profileP, 4000);
      profileRow = pr || null;
    } catch {
      profileRow = null;
    }

    if (!profileRow?.current_org_id) {
      console.error('Geen current_org_id voor user:', user.id);
      if (!cancelled) {
        setProfile(null);
        setAllLeads([]);
        setLabels([]);
        setLoading(false); // laat UI niet hangen
      }
      return;
    }

    if (!cancelled) {
  setProfile(profileRow);
  // Init geluid uit profiel (default = true als niet gezet)
  const prefSound = profileRow?.preferences?.newLeadSoundOn;
  setSoundOn(prefSound == null ? true : !!prefSound);
}
const orgId = profileRow.current_org_id;


    // 4) Data-parallel: LEADS (kritiek) + LABELS (mag later)
    const leadsQ = supabase
      .from('leads')
      .select(`
  *,
  phone, email,
  linkedin_url, facebook_url, instagram_url, twitter_url,
  meta_description, category, category_nl, place_id, place_types
`)

      .eq('org_id', orgId)
      .not('company_name', 'is', null)
      .order('timestamp', { ascending: false })  // nieuwste eerst
      .limit(500);                               // init sneller maken

    const labelsQ = supabase
      .from('labels')
      .select('*')
      .eq('org_id', orgId);

    // Start beide zonder te wachten
    const leadsP  = withTimeout(leadsQ, 8000).then(({ data }) => data || []).catch(() => []);
    const labelsP = withTimeout(labelsQ, 8000).then(({ data }) => data || []).catch(() => []);

    // 4a) Wacht *alleen* op LEADS om UI te tonen
    const leads = await leadsP;

    if (cancelled) return;

    setAllLeads(leads || []);
    const categoriesSet = new Set(
  (leads || []).map(l => (l.category_nl || l.category)).filter(Boolean)
);
setUniqueCategories(Array.from(categoriesSet).sort());


    // 🚀 Belangrijk: zet loading NU al uit → dashboard komt in beeld
    setLoading(false);

    // 4b) Labels vullen zodra binnen (niet blocking)
    labelsP.then((lbls) => {
      if (cancelled) return;
      setLabels(lbls || []);
    });

    // 5) Realtime subscriptions (blokkeert niet)
    

    const labelsCh = supabase
  .channel(`labels:org:${orgId}`)
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'labels', filter: `org_id=eq.${orgId}` },
    (payload) => {
      setLabels((prev = []) => {
        const p = Array.isArray(prev) ? prev : [];
        const row = payload.new ?? payload.old;

        // helper: vervang of voeg toe
        const upsert = (arr, item) => {
          const exists = arr.some(l => l.id === item.id);
          return exists
            ? arr.map(l => (l.id === item.id ? item : l))
            : [item, ...arr];
        };

        if (payload.eventType === 'INSERT') {
          // ⛔️ voorkom dubbele invoeging als we al optimistic of via select(*) hebben toegevoegd
          return upsert(p, payload.new);
        }

        if (payload.eventType === 'UPDATE') {
          return p.map(l => (l.id === payload.new.id ? payload.new : l));
        }

        if (payload.eventType === 'DELETE') {
          return p.filter(l => l.id !== payload.old.id);
        }

        return p;
      });
    }
  )
  .subscribe();


    // 6) Cleanup vanuit run (als effect opnieuw draait)
    return () => {
      supabase.removeChannel(labelsCh);
    };
  };

  const unsub = run();
  return () => {
    // markeer als geannuleerd om setState na unmount te voorkomen
    cancelled = true;
    // realtime cleanup (als run al ver was)
    if (typeof unsub === 'function') try { unsub(); } catch {}
  };
}, [router]);

// 🔔 Houd soundOn live in sync met profiel-voorkeuren uit Account
// ⬇️ Realtime: volg profiel-voorkeuren (newLeadSoundOn) live
useEffect(() => {
  if (!user?.id) return;

  const ch = supabase
    .channel(`profiles:preferences:${user.id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
      (payload) => {
        const pref = payload?.new?.preferences || {};
        const v = pref.newLeadSoundOn;
        // zelfde default als bij initial load: true indien niet gezet
        setSoundOn(v == null ? true : !!v);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(ch); };
}, [user?.id]);


  // ⬇️ Batch: alle notities in één keer (géén N+1 meer)
useEffect(() => {
  // We hebben een org en leads nodig
  if (!profile?.current_org_id || allLeads.length === 0) return;

  // Unieke domeinen uit de lijst
  const domains = [...new Set(allLeads.map(l => l.company_domain).filter(Boolean))];
  if (domains.length === 0) return;

  let cancelled = false;

  (async () => {
    try {
      const { data, error } = await supabase
        .from('lead_notes')
        .select('company_domain, note, updated_at')
        .eq('org_id', profile.current_org_id)
        .in('company_domain', domains);

      if (error) {
        console.error('Notes batch fetch error:', error.message);
        return;
      }
      if (cancelled) return;

      // Omdat (org_id, company_domain) uniek is, is er max 1 rij per domein
      const nextNotes = {};
      const nextUpdated = {};
      for (const row of (data || [])) {
        nextNotes[row.company_domain] = row.note || '';
        if (row.updated_at) nextUpdated[row.company_domain] = row.updated_at;
      }

      setNotesByDomain(prev => ({ ...prev, ...nextNotes }));
      setNoteUpdatedAt(prev => ({ ...prev, ...nextUpdated }));
    } catch (e) {
      console.error('Notes batch fetch exception:', e);
    }
  })();

  return () => { cancelled = true; };
}, [profile?.current_org_id, allLeads]);




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
if (categoryFilter && ((l.category_nl || l.category) !== categoryFilter)) return false;


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

// ── PAGINATION HELPERS ──────────────────────────────────────────
const pageCount = Math.max(1, Math.ceil(companies.length / itemsPerPage) || 1);

const goToPage = (n) => {
  const next = Math.min(Math.max(n, 1), pageCount);
  setCurrentPage(next);

  // list (middenkolom) naar boven scrollen voor nette UX
  const listEl = columnRefs.current?.[1];
  if (listEl?.scrollTo) listEl.scrollTo({ top: 0, behavior: "smooth" });
};

// Toon compacte reeks paginanummers met ellipses (max ±5 zichtbaar)
const pages = useMemo(() => {
  const total = pageCount;
  const cur = currentPage;
  const delta = 2;
  const range = [];
  const withDots = [];
  let last;

  if (total <= 7) {
    for (let i = 1; i <= total; i++) range.push(i);
  } else {
    range.push(1);
    for (let i = cur - delta; i <= cur + delta; i++) {
      if (i > 1 && i < total) range.push(i);
    }
    range.push(total);
  }

  range.sort((a, b) => a - b);
  for (const i of range) {
    if (last) {
      if (i - last === 2) withDots.push(last + 1);
      else if (i - last > 2) withDots.push("ellipsis");
    }
    withDots.push(i);
    last = i;
  }
  return withDots;
}, [currentPage, pageCount]);

// Clampen als dataset kleiner wordt (bijv. door filters)
useEffect(() => {
  if (currentPage > pageCount) setCurrentPage(pageCount);
}, [pageCount]); // eslint-disable-line react-hooks/exhaustive-deps

// Reset naar pagina 1 bij wijzigingen die de lijst beïnvloeden
useEffect(() => {
  setCurrentPage(1);
}, [
  filterType,
  customRange[0],
  customRange[1],
  labelFilter,
  minVisits,
  minDuration,
  categoryFilter,
  globalSearch,
  sortOrder,
  // array → string zodat de dep stabiel triggert bij inhoudswijziging
  useMemo(() => visitorTypeFilter.slice().sort().join(","), [visitorTypeFilter]),
]); // eslint-disable-line react-hooks/exhaustive-deps
// ────────────────────────────────────────────────────────────────


  const selectedCompanyData = selectedCompany
  ? allCompanies.find((c) => c.company_name === selectedCompany)
  : null;

  // Domein → company (lookup)
const domainToCompany = useMemo(() => {
  const m = new Map();
  for (const c of allCompanies) {
    if (c?.company_domain) m.set(c.company_domain, c);
  }
  return m;
}, [allCompanies]);

// Bovenaan te tonen bedrijven die buiten je filters vallen (met badge)
const overrideCompanies = useMemo(() => {
  const arr = Array.from(overrideDomains)
    .map(d => domainToCompany.get(d))
    .filter(Boolean);
  // Sorteer zoals 'recent'
  arr.sort((a, b) => {
    const lastA = fullVisitMap[a.company_name]?.[0]?.timestamp || '';
    const lastB = fullVisitMap[b.company_name]?.[0]?.timestamp || '';
    return new Date(lastB) - new Date(lastA);
  });
  return arr;
}, [overrideDomains, domainToCompany, fullVisitMap]);


  // Domeinen van bedrijven die nu (met filters) zichtbaar zijn
const visibleCompanyDomains = useMemo(() => {
  const s = new Set();
  for (const c of companies) {
    if (c?.company_domain) s.add(c.company_domain);
  }
  return s;
}, [companies]);


// Refs zodat realtime callbacks altijd de nieuwste sets zien
const visibleDomainsRef = useRef(new Set());
useEffect(() => {
  visibleDomainsRef.current = visibleCompanyDomains;
}, [visibleCompanyDomains]);

function companyWouldBeVisibleAfterAddingLead(newLead) {
  // 1) Per-lead filters (zoals in filteredLeads)
  if (!newLead?.timestamp || !isInDateRange(newLead.timestamp)) return false;
  if (categoryFilter && ((newLead.category_nl || newLead.category) !== categoryFilter)) return false;
  if (minDuration && (!newLead.duration_seconds || newLead.duration_seconds < parseInt(minDuration))) return false;

  // Label-filter op bedrijfsniveau
  if (labelFilter) {
    const hasLabel = labels.find(
      (lab) => lab.company_name === newLead.company_name && lab.label === labelFilter
    );
    if (!hasLabel) return false;
  }

  // 2) Bestaande sessies binnen filter + nieuwe lead toevoegen
  const existingInRange = (allLeads || []).filter((l) => {
    if (l.company_name !== newLead.company_name) return false;
    if (!l.timestamp || !isInDateRange(l.timestamp)) return false;
    if (categoryFilter && ((l.category_nl || l.category) !== categoryFilter)) return false;
    if (minDuration && (!l.duration_seconds || l.duration_seconds < parseInt(minDuration))) return false;
    return true;
  });
  const augmented = [...existingInRange, newLead];

  // 3) Minimaal aantal bezoeken
  if (minVisits && augmented.length < parseInt(minVisits)) return false;

  // 4) Bezoekersgedrag (zelfde logica als in je lijst)
  if (visitorTypeFilter.length > 0) {
    const uniqueVisitors = new Set(
      augmented.map((v) => v.anon_id || `onbekend-${v.id}`)
    );

    const match = visitorTypeFilter.some((type) => {
      if (type === "first") return uniqueVisitors.size === 1;
      if (type === "returning") return uniqueVisitors.size > 1;
      if (type === "highEngagement") {
        const totalDuration = augmented.reduce((sum, v) => sum + (v.duration_seconds || 0), 0);
        const latestTs = augmented
          .map(v => v.timestamp ? new Date(v.timestamp).getTime() : 0)
          .reduce((a, b) => Math.max(a, b), 0);
        const now = Date.now();
        const recencyDays = latestTs ? (now - latestTs) / (1000 * 60 * 60 * 24) : 999;

        const visitsScore = Math.min(augmented.length / 10, 1);
        const durationScore = Math.min(totalDuration / 600, 1);
        const recencyScore =
          recencyDays < 1 ? 1 :
          recencyDays < 7 ? 0.7 :
          recencyDays < 30 ? 0.4 : 0.1;

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
}

// Eén centrale handler voor INSERT events (realtime + gap-fill)
// Eén centrale handler voor binnenkomende leads (INSERT/UPDATE)
function handleIncomingLead(lead, { silent = false } = {}) {
  console.log('[RT] incoming lead', { lead, silent });

  // We hebben minimaal een domein nodig
  if (!lead?.company_domain) return;

  // Alleen tonen als verrijkt (bedrijf bekend)
  if (!lead.company_name) return; // wachten op UPDATE met company_name

  // ➊ Altijd eerst aan de banner-buffer toevoegen (één keer per domein)
  setPendingByDomain((prev) => {
    if (prev.has(lead.company_domain)) return prev; // al in de teller
    const next = new Map(prev);
    next.set(lead.company_domain, lead);
    return next;
  });

  // ➋ Als het bedrijf al zichtbaar is, laat dan óók een korte “pulse”-badge zien.
  if (visibleDomainsRef.current.has(lead.company_domain)) {
    setPulseDomains((prev) => {
      const next = new Set(prev);
      next.add(lead.company_domain);
      return next;
    });
    setTimeout(() => {
      setPulseDomains((prev) => {
        const next = new Set(prev);
        next.delete(lead.company_domain);
        return next;
      });
    }, 4000);
  }

  // ➌ Geluidje (optioneel)
  if (!silent) pingSound(soundOn);

  // 🔎 Belangrijk: we stoppen hier NIET meer vroegtijdig.
  // Ook als het bedrijf al zichtbaar is of al in override staat,
  // blijft het in de banner-buffer staan tot de gebruiker klikt.
}


useEffect(() => {
  const orgId = profile?.current_org_id;
  if (!orgId) return;

  const subscribedAtIso = new Date().toISOString();

  const ch = supabase
    .channel(`leads:org:${orgId}:newCompanies`)
    // INSERT: alleen doorgeven als al verrijkt; anders wachten we op UPDATE
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'leads', filter: `org_id=eq.${orgId}` },
      (payload) => {
        const row = payload?.new;
        if (!row?.company_domain) return;
        if (row.company_name) handleIncomingLead(row, { silent: false });
      }
    )
    // UPDATE: pak ‘m op zodra verrijkt (company_name ging van null → waarde)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'leads', filter: `org_id=eq.${orgId}` },
      (payload) => {
        const oldRow = payload?.old;
        const row    = payload?.new;
        if (!row?.company_domain) return;
        const becameEnriched = (!oldRow || !oldRow.company_name) && !!row.company_name;
        if (becameEnriched) handleIncomingLead(row, { silent: false });
      }
    )
    .subscribe();
    
  // GAP-FILL: alles tussen sessieStart en subscribe-tijd alsnog toevoegen (stil, geen ping)
  (async () => {
    try {
      const { data } = await supabase
        .from('leads')
        .select('id, company_name, company_domain, timestamp, created_at, duration_seconds, confidence, auto_confidence')
        .eq('org_id', orgId)
        .gte('created_at', sessionStartRef.current)
        .lte('created_at', subscribedAtIso);
      (data || []).forEach(l => handleIncomingLead(l, { silent: true }));
    } catch {}
  })();

 return () => { supabase.removeChannel(ch); };
}, [profile?.current_org_id, soundOn]);


// === Nieuwe-bedrijven knop: teller + handlers ===
const newCompaniesCount = pendingByDomain.size;

function applyPendingNewCompanies() {
  if (pendingByDomain.size === 0) return;

  const pendingLeads = Array.from(pendingByDomain.values());

  // Nieuwste eerst
  pendingLeads.sort((a, b) => {
    const ta = new Date(a.timestamp || a.created_at || 0).getTime();
    const tb = new Date(b.timestamp || b.created_at || 0).getTime();
    return tb - ta;
  });

  // Voeg alles toe aan allLeads (ook buiten filter)
  setAllLeads(prev => [...pendingLeads, ...prev]);

  // Bepaal welke (nog) buiten je filters vallen → tijdelijk overriden met badge
  const outside = pendingLeads.filter(l => !companyWouldBeVisibleAfterAddingLead(l));
  if (outside.length > 0) {
    setOverrideDomains(prev => {
      const next = new Set(prev);
      outside.forEach(l => next.add(l.company_domain));
      return next;
    });
  }

  // Buffer leeg → knop verdwijnt
  setPendingByDomain(new Map());
}

// Badge weghalen zodra een override-domein door de filters zichtbaar is
useEffect(() => {
  if (overrideDomains.size === 0) return;
  setOverrideDomains(prev => {
    if (prev.size === 0) return prev;
    const next = new Set(prev);
    for (const d of Array.from(next)) {
      if (visibleCompanyDomains.has(d)) next.delete(d);
    }
    return next;
  });
}, [visibleCompanyDomains, overrideDomains.size]);

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



const isSelectedOverride =
  !!(selectedCompanyData?.company_domain && overrideDomains.has(selectedCompanyData.company_domain));

const filteredActivities = (isSelectedOverride ? allLeads : filteredLeads)
  .filter(l => l.company_name === selectedCompany);


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
            <NewCompaniesButton
  count={newCompaniesCount}
  onApply={applyPendingNewCompanies}
/>


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
          <DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant="outline"
      className="w-full justify-between"
      aria-label="Kies periode"
    >
      {({
        alles: "Alles",
        vandaag: "Vandaag",
        gisteren: "Gisteren",
        "deze-week": "Deze week",
        "vorige-week": "Vorige week",
        "vorige-maand": "Vorige maand",
        "dit-jaar": "Dit jaar",
        aangepast: "Aangepast",
      }[filterType] ?? "Periode")}
      <ChevronDown className="w-4 h-4 opacity-60" />
    </Button>
  </DropdownMenuTrigger>

  <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
    <DropdownMenuLabel>Periode</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuRadioGroup
      value={filterType}
      onValueChange={(val) => {
        setFilterType(val);
        setSelectedCompany(null);
        setInitialVisitorSet(false);
      }}
    >
      <DropdownMenuRadioItem value="alles">Alles</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="vandaag">Vandaag</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="gisteren">Gisteren</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="deze-week">Deze week</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="vorige-week">Vorige week</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="vorige-maand">Vorige maand</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dit-jaar">Dit jaar</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="aangepast">Aangepast</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>

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

// Cataloguslabel verwijderen (links): optimistic + API cascade
const handleDeleteGlobalLabel = async (labelId) => {
  if (!labelId) return;

  // 1) Vind de catalogusrij in state
  const row = (labels || []).find(l => l.id === labelId);
  if (!row) return;

  const orgId = profile?.current_org_id ?? null;
  if (!orgId) { alert("Geen actieve organisatie."); return; }

  // 2) Alle rijen met dezelfde org + label (dus ook toegewezen aan bedrijven)
  const affectedIds = (labels || [])
    .filter(l => l.org_id === orgId && l.label === row.label)
    .map(l => l.id);

  // 3) Optimistic: haal ze alvast uit de UI
  const backup = [...(labels || [])];
  setLabels(prev => (prev || []).filter(l => !affectedIds.includes(l.id)));

  try {
    // 4) Server: roep de cascade-API aan
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Niet ingelogd");

    const res = await fetch('/api/labels/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ labelId, cascade: true }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || `Serverfout ${res.status}`);
    }

    // 5) Klaar: realtime events houden state verder synchroon
  } catch (e) {
    // Rollback bij fout
    setLabels(() => backup);
    alert("Fout bij label verwijderen: " + (e?.message || e));
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
  <div className="mb-4">
    <Input
      type="text"
      placeholder="Labelnaam"
      aria-label="Labelnaam"
      value={newLabel}
      onChange={(e) => setNewLabel(e.target.value)}
      autoFocus
    />
    <div className="mt-2 flex gap-2">
      <button
        onClick={handleSaveNewLabel}
        className="bg-blue-600 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
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

      
          <Input
  type="number"
  inputMode="numeric"
  min={0}
  step={1}
  placeholder="Minimaal bezoeken"
  aria-label="Minimaal bezoeken"
  value={minVisits}
  onChange={(e) => setMinVisits(e.target.value)}
/>

          <Input
  type="number"
  inputMode="numeric"
  min={0}
  step={1}
  placeholder="Minimale duur (s)"
  aria-label="Minimale duur (seconden)"
  value={minDuration}
  onChange={(e) => setMinDuration(e.target.value)}
/>

          <DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant="outline"
      className="w-full justify-between"
      aria-label="Kies categorie"
    >
      {categoryFilter ? categoryFilter : "Alle categorieën"}
      <ChevronDown className="w-4 h-4 opacity-60" />
    </Button>
  </DropdownMenuTrigger>

  <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
    <DropdownMenuLabel>Categorie</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuRadioGroup
      value={categoryFilter ?? ""}
      onValueChange={(val) => setCategoryFilter(val)}
    >
      <div className="max-h-72 overflow-auto">
        <DropdownMenuRadioItem value="">Alle categorieën</DropdownMenuRadioItem>
        {uniqueCategories.map((cat) => (
          <DropdownMenuRadioItem key={cat} value={cat}>
            {cat}
          </DropdownMenuRadioItem>
        ))}
      </div>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>


          <DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant="outline"
      className="w-full justify-between"
      aria-label="Kies sortering"
    >
      {sortOrder === "aantal" ? "Sorteer op aantal bezoeken" : "Sorteer op laatst bezocht"}
      <ChevronDown className="w-4 h-4 opacity-60" />
    </Button>
  </DropdownMenuTrigger>

  <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
    <DropdownMenuLabel>Sorteer op</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuRadioGroup
      value={sortOrder}
      onValueChange={(val) => setSortOrder(val)}
    >
      <DropdownMenuRadioItem value="recent">
        Sorteer op laatst bezocht
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="aantal">
        Sorteer op aantal bezoeken
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>


<div className="space-y-2">
  <label className="block text-sm font-bold text-gray-700">
    Bezoekersgedrag
  </label>

  <div className="flex flex-col gap-2">
    {[
      { value: "first",          label: "Eerste keer bezocht" },
      { value: "returning",      label: "Terugkerende bezoeker" },
      { value: "highEngagement", label: "Hoge betrokkenheid" },
    ].map((option) => {
      const id = `visitor-${option.value}`;
      const checked = visitorTypeFilter.includes(option.value);

      return (
        <div key={option.value} className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={checked}
            // Radix geeft boolean | "indeterminate" → cast naar boolean
            onCheckedChange={(ch) => {
              const on = !!ch;
              setVisitorTypeFilter((prev) => {
                if (on) return prev.includes(option.value) ? prev : [...prev, option.value];
                return prev.filter((v) => v !== option.value);
              });
            }}
          />
          <Label htmlFor={id} className="text-sm text-gray-700">
            {option.label}
          </Label>
        </div>
      );
    })}
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
<NewCompaniesButton
  count={newCompaniesCount}
  onApply={applyPendingNewCompanies}
/>

{/* ── Overrides: buiten filter, altijd bovenaan met badge ───────── */}
{overrideCompanies.map((company) => {
  const leads = fullVisitMap[company.company_name] || [];
  const uniqueVisitorCount = new Set(leads.map(l => l.anon_id || `onbekend-${l.id}`)).size;
  const totalDuration = leads.reduce((s,l)=> s+(l.duration_seconds||0), 0);
  const minutes = Math.floor(totalDuration / 60);
  const seconds = totalDuration % 60;

  const latestVisit = leads[0]?.timestamp ? new Date(leads[0].timestamp) : null;
  const now = new Date();
  const recencyDays = latestVisit ? (now - latestVisit) / (1000*60*60*24) : 999;
  const visitsScore   = Math.min(leads.length / 10, 1);
  const durationScore = Math.min(totalDuration / 600, 1);
  const recencyScore  = recencyDays < 1 ? 1 : recencyDays < 7 ? 0.7 : recencyDays < 30 ? 0.4 : 0.1;
  const leadRating    = Math.round((visitsScore*0.4 + durationScore*0.3 + recencyScore*0.3) * 100);
  let ratingColor = "#ef4444"; if (leadRating >= 80) ratingColor="#22c55e"; else if (leadRating >= 61) ratingColor="#eab308"; else if (leadRating >= 31) ratingColor="#f97316";

  return (
    <div
      key={`override-${company.company_name}`}
      onClick={() => { setSelectedCompany(company.company_name); setInitialVisitorSet(false); }}
      className="cursor-pointer bg-white border border-amber-300 rounded-xl p-4 shadow hover:shadow-lg hover:scale-[1.02] transition-transform duration-200 ring-1 ring-amber-300"
      title="Tijdelijk getoond buiten je filter"
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            {company.company_domain && (
              <img
                src={`https://img.logo.dev/${company.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
                alt="logo"
                className="w-6 h-6 object-contain rounded"
                onError={(e)=> (e.currentTarget.style.display='none')}
              />
            )}
            {(() => { const flagCode = getFlagCodeFromLead(company); return flagCode ? (
              <img
                src={`https://flagcdn.com/w20/${flagCode}.png`}
                alt={company.domain_country || flagCode.toUpperCase()}
                className="w-5 h-3 rounded shadow-sm"
                onError={(e)=> (e.currentTarget.style.display='none')}
                loading="lazy"
              />
            ) : null; })()}
            <h3 className="text-base font-semibold text-gray-800">{company.company_name}</h3>

{pulseDomains.has(company.company_domain) && (
  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800 border border-blue-300">
    Nieuw bezoek
  </span>
)}

{overrideDomains.has(company.company_domain) && (
  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
    Buiten je filter
  </span>
)}

          </div>

          {company.kvk_city && <p className="text-xs text-gray-500 mt-0.5">📍 {company.kvk_city}</p>}
          {company.company_domain && <p className="text-xs text-gray-500 truncate">🌐 {company.company_domain}</p>}
          {(company.category_nl || company.category) && (
            <p className="text-xs text-gray-500 truncate">🏷️ {company.category_nl || company.category}</p>
          )}
        </div>

        <div className="text-right">
          <p className="text-xs text-gray-500">{uniqueVisitorCount} {uniqueVisitorCount === 1 ? 'bezoeker' : 'bezoekers'}</p>
          <p className="text-xs text-gray-500">{minutes}m {seconds}s</p>
          <div className="mt-3">
            <div className="w-full bg-gray-200 rounded-full h-2 relative">
              <div className="h-2 rounded-full" style={{ width: `${leadRating}%`, backgroundColor: ratingColor }} />
            </div>
            <div className="text-xs text-gray-500 mt-1">Lead score: {leadRating}/100</div>
            <div className="text-[10px] text-gray-400">
              {leadRating < 31 && "Laag"}
              {leadRating >= 31 && leadRating <= 60 && "Gemiddeld"}
              {leadRating >= 61 && leadRating <= 79 && "Hoog"}
              {leadRating >= 80 && "Zeer hoog"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
})}


  {companies.length === 0 && overrideCompanies.length === 0 && (
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
      onError={(e) => (e.currentTarget.style.display = "none")}
    />
  )}

  {/* Eén enkele bron voor de vlag (met normalisatie) */}
{/* Eén enkele bron voor de vlag (met normalisatie) */}
{(() => {
  const flagCode = getFlagCodeFromLead(company); // ✅ gebruik company
  return flagCode ? (
    <img
      src={`https://flagcdn.com/w20/${flagCode}.png`}
      alt={company.domain_country || flagCode.toUpperCase()}
      className="w-5 h-3 rounded shadow-sm"
      title={company.domain_country || flagCode.toUpperCase()}
      onError={(e) => (e.currentTarget.style.display = "none")}
      loading="lazy"
    />
  ) : null;
})()}



  <h3 className="text-base font-semibold text-gray-800">
    {company.company_name}
  </h3>

  {overrideDomains.has(company.company_domain) && (
    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
      Buiten je filter
    </span>
  )}
</div>



              {company.kvk_city && (
                <p className="text-xs text-gray-500 mt-0.5">📍 {company.kvk_city}</p>
              )}
              {company.company_domain && (
                <p className="text-xs text-gray-500 truncate">

                  🌐 {company.company_domain}
                </p>
              )}
{(company.category_nl || company.category) && (
  <p className="text-xs text-gray-500 truncate">
    🏷️ {company.category_nl || company.category}
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
  .filter(l => l.org_id === profile?.current_org_id)
  .filter(l => l.company_name === company.company_name)
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
                    const id = label.id;
const backup = [...(labels || [])];

// Optimistic remove
setLabels(prev => (prev || []).filter(l => l.id !== id));

try {
  const { error } = await supabase
    .from("labels")
    .delete()
    .eq("id", id);

  if (error) {
    setLabels(() => backup);
    console.error("Label verwijderen mislukt:", error.message);
    alert("Fout bij verwijderen: " + error.message);
  }
  // Geen refresh, realtime doet de rest
} catch (e2) {
  setLabels(() => backup);
  alert("Netwerkfout bij verwijderen: " + (e2?.message || e2));
  console.error(e2);
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
 <Pagination className="mt-6">
  <PaginationContent>
    <PaginationItem>
      <PaginationPrevious
        href="#"
        onClick={(e) => {
          e.preventDefault();
          goToPage(currentPage - 1);
        }}
        aria-disabled={currentPage === 1}
        className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
      />
    </PaginationItem>

    {pages.map((p, idx) =>
      p === "ellipsis" ? (
        <PaginationItem key={`dots-${idx}`} className="hidden sm:list-item">
          <PaginationEllipsis />
        </PaginationItem>
      ) : (
        <PaginationItem key={p} className="hidden sm:list-item">
          <PaginationLink
            href="#"
            onClick={(e) => {
              e.preventDefault();
              goToPage(p);
            }}
            isActive={p === currentPage}
            aria-label={`Ga naar pagina ${p}`}
          >
            {p}
          </PaginationLink>
        </PaginationItem>
      )
    )}

    <PaginationItem>
      <PaginationNext
        href="#"
        onClick={(e) => {
          e.preventDefault();
          goToPage(currentPage + 1);
        }}
        aria-disabled={currentPage === pageCount}
        className={currentPage === pageCount ? "pointer-events-none opacity-50" : ""}
      />
    </PaginationItem>
  </PaginationContent>
</Pagination>


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
  {(() => {
  const flagCode = getFlagCodeFromLead(selectedCompanyData); // gebruikt alleen domain_country
  return flagCode ? (
    <img
      src={`https://flagcdn.com/w20/${flagCode}.png`}
      alt={selectedCompanyData.domain_country || flagCode.toUpperCase()}
      className="w-5 h-3 rounded shadow-sm"
      title={selectedCompanyData.domain_country || flagCode.toUpperCase()}
      onError={(e) => (e.currentTarget.style.display = "none")}
      loading="lazy"
    />
  ) : null;
})()}


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

                    const orgId = profile?.current_org_id;
if (!orgId) return;

// 1) Optimistic toevoegen
const optimistic = {
  id: `temp-${Date.now()}`,
  org_id: orgId,
  company_name: selectedCompanyData.company_name,
  label: label.label,
  color: label.color,
  inserted_at: new Date().toISOString(),
};
setLabels(prev => [optimistic, ...(prev || [])]);

try {
  // 2) Server-insert met RETURNING *
  const { data: saved, error } = await supabase
    .from("labels")
    .insert({
      org_id: orgId,
      company_name: selectedCompanyData.company_name,
      label: label.label,
      color: label.color,
    })
    .select("*")
    .single();

  if (error) {
    setLabels(prev => (prev || []).filter(l => l.id !== optimistic.id));
    alert("Fout bij label toewijzen: " + (error.message || "onbekend"));
    console.error(error);
    return;
  }

  // 3) Temp vervangen door server-row
  setLabels(prev => {
    const rest = (prev || []).filter(l => l.id !== optimistic.id);
    const noDup = rest.filter(l => l.id !== saved.id);
    return [saved, ...noDup];
  });

  setOpenLabelMenus({});
} catch (e) {
  setLabels(prev => (prev || []).filter(l => l.id !== optimistic.id));
  alert("Netwerkfout bij label toewijzen: " + (e?.message || e));
  console.error(e);
}


                
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
  .filter(l => l.org_id === profile?.current_org_id)
  .filter(l => l.company_name === selectedCompany)
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


{/* ─────────────────────────────────────────────── */}

       {/* ─── Texteer-veld als openNoteFor gelijk is ───────────────── */}
{openNoteFor === selectedCompanyData.company_domain && (
  <div className="mt-2">
    <Textarea
      rows={4}
      value={noteDraft}
      onChange={(e) => setNoteDraft(e.target.value)}
      placeholder="Typ hier je notitie…"
      className="min-h-[120px] resize-y"
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
            const saved = json?.note || json;
            const updated_at = saved?.updated_at ?? null;

            setNotesByDomain((prev) => ({ ...prev, [openNoteFor]: noteDraft }));
            setNoteUpdatedAt((prev) => ({ ...prev, [openNoteFor]: updated_at }));

            setOpenNoteFor(null);
          } catch (e) {
            alert(`Opslaan mislukt: ${e?.message || e}`);
          }
        }}
        className="bg-blue-600 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-blue-700 transition"
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
              body: JSON.stringify({
                company_domain: openNoteFor,
                deleteAllForDomain: true,
              }),
            });

            if (!delRes.ok) {
              const err = await delRes.json().catch(() => ({}));
              alert(`Verwijderen mislukt: ${err.error || delRes.status}`);
              return;
            }

            setNotesByDomain((prev) => {
              const next = { ...prev };
              delete next[openNoteFor];
              return next;
            });

            setNoteUpdatedAt((prev) => {
              const next = { ...prev };
              delete next[openNoteFor];
              return next;
            });

            setOpenNoteFor(null);
          } catch (e) {
            alert(`Verwijderen mislukt: ${e?.message || e}`);
          }
        }}
        className="border border-gray-300 px-4 py-1.5 text-sm rounded-lg hover:bg-gray-100 transition"
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
      <div className="mt-2 text-xs text-gray-600">
        {deriveVisitorSource(sessions)}
      </div>

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
