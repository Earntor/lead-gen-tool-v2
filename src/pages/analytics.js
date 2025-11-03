// src/pages/analytics.js
"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { useRouter } from "next/router"
import { supabase } from "../lib/supabaseClient"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"

import { BarChartComponent, BarChartHorizontalComponent } from "@/components/ui/chart"

// =============== Tijdzone helpers (Europe/Amsterdam) ===============
const TZ = "Europe/Amsterdam"
// start van dag in NL
function startOfDayNL(d) {
  const z = new Date(d)
  // naar middernacht NL: maak eerst lokale NL str, dan terug naar Date
  const y = z.toLocaleString("en-CA", { timeZone: TZ, year: "numeric" })
  const m = z.toLocaleString("en-CA", { timeZone: TZ, month: "2-digit" })
  const dd = z.toLocaleString("en-CA", { timeZone: TZ, day: "2-digit" })
  return new Date(`${y}-${m}-${dd}T00:00:00`)
}
function endOfDayNL(d) {
  const s = startOfDayNL(d)
  return new Date(s.getTime() + 24 * 60 * 60 * 1000 - 1)
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function addMonths(d, n) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}
function startOfWeekNL(d) {
  // Maandag = weekstart
  const day = d.getDay() || 7 // 1..7 (ma=1)
  const monday = addDays(d, 1 - day)
  return startOfDayNL(monday)
}
function endOfWeekNL(d) {
  const s = startOfWeekNL(d)
  return endOfDayNL(addDays(s, 6))
}
function startOfMonthNL(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1)
  return startOfDayNL(x)
}
function endOfMonthNL(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return endOfDayNL(x)
}
function startOfYearNL(d) {
  return startOfDayNL(new Date(d.getFullYear(), 0, 1))
}
function endOfYearNL(d) {
  return endOfDayNL(new Date(d.getFullYear(), 11, 31))
}

// As-labels
const fmtDay = (d) =>
  d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", timeZone: TZ }).replace(".", "")
const fmtMonth = (d) =>
  d.toLocaleDateString("nl-NL", { month: "short", year: "2-digit", timeZone: TZ }).replace(".", "").toLowerCase()


// =============== Aggregatie ===============
function eachDayRange(from, to) {
  const out = []
  let cur = startOfDayNL(from)
  const end = endOfDayNL(to)
  while (cur <= end) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

function eachMonthRange(from, to) {
  const out = []
  let cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cur <= end) {
    out.push(new Date(cur))
    cur = addMonths(cur, 1)
  }
  return out
}

function diffDays(from, to) {
  const ms = startOfDayNL(to) - startOfDayNL(from)
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1
}

/**
 * leads: [{created_at: ISO, ...}]
 * Bepaalt automatisch de granulariteit:
 * - <= 31 dagen  => per dag
 * - >  31 dagen  => per maand
 * Retourneert [{ name, value }]
 */
function groupLeadsAuto(leads, from, to) {
  const days = diffDays(from, to)
  if (days <= 31) {
    // per dag
    const buckets = new Map(eachDayRange(from, to).map((d) => [fmtDay(d), 0]))
    for (const row of (leads || [])) {
      const dt = new Date(row.created_at)
      const key = fmtDay(dt)
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
    }
    return Array.from(buckets, ([name, value]) => ({ name, value }))
  } else {
    // per maand
    const months = eachMonthRange(from, to)
    const buckets = new Map(months.map((d) => [fmtMonth(d), 0]))
    for (const row of (leads || [])) {
      const dt = new Date(row.created_at)
      const key = fmtMonth(new Date(dt.getFullYear(), dt.getMonth(), 1))
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
    }
    return Array.from(buckets, ([name, value]) => ({ name, value }))
  }
}

// NIEUW: categorie-aggregatie (top N, aflopend)
function groupCategories(leads, topN = 12) {
  const map = new Map()
  for (const row of (leads || [])) {
 const key = row.company_category?.trim() || "Onbekend"
    map.set(key, (map.get(key) || 0) + 1)
  }
  const arr = Array.from(map, ([name, value]) => ({ name, value }))
  arr.sort((a, b) => b.value - a.value)
  return arr.slice(0, topN)
}


// =============== Presets ===============
const PRESETS = {
  vandaag: "vandaag",
  gisteren: "gisteren",
  dezeWeek: "deze_week",
  vorigeWeek: "vorige_week",
  vorigeMaand: "vorige_maand",
  ditJaar: "dit_jaar",
  aangepast: "aangepast",
}

function getRangeForPreset(preset) {
  const now = new Date()
  switch (preset) {
    case PRESETS.vandaag: {
      const f = startOfDayNL(now)
      const t = endOfDayNL(now)
      return { from: f, to: t }
    }
    case PRESETS.gisteren: {
      const y = addDays(now, -1)
      return { from: startOfDayNL(y), to: endOfDayNL(y) }
    }
    case PRESETS.dezeWeek: {
      return { from: startOfWeekNL(now), to: endOfWeekNL(now) }
    }
    case PRESETS.vorigeWeek: {
      const lastWeek = addDays(now, -7)
      return { from: startOfWeekNL(lastWeek), to: endOfWeekNL(lastWeek) }
    }
    case PRESETS.vorigeMaand: {
      const lastMonth = addMonths(now, -1)
      return { from: startOfMonthNL(lastMonth), to: endOfMonthNL(lastMonth) }
    }
    case PRESETS.ditJaar: {
      return { from: startOfYearNL(now), to: endOfYearNL(now) }
    }
    default:
      return { from: startOfMonthNL(now), to: endOfDayNL(now) }
  }
}

// =============== UI Component ===============
export default function Analytics() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  // filter state
const [preset, setPreset] = useState(PRESETS.dezeWeek)
  const initialRange = getRangeForPreset(PRESETS.dezeWeek)
  const [range, setRange] = useState({ from: initialRange.from, to: initialRange.to })
  const [openCustom, setOpenCustom] = useState(false) // popover voor kalender

  // data
const [chartData, setChartData] = useState([])
const [categoryData, setCategoryData] = useState([])
const [fetching, setFetching] = useState(false)
 // scope filters
 const [orgId, setOrgId] = useState(null)
 const [siteId, setSiteId] = useState(null)

  // auth
  useEffect(() => {
    let isActive = true
    async function boot() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace("/login?next=/analytics")
        return
      }
      // 👉 profiel ophalen om org/site te weten
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("organization_id, active_organization_id, default_organization_id, site_id, active_site_id, selected_site_id")
        .eq("id", user.id)
        .single()
      if (pErr) {
        console.warn("[Analytics] profile error:", pErr)
      } else {
        // kies de eerste aanwezige org/site kolom die bestaat
        const o =
          profile?.active_organization_id ??
          profile?.organization_id ??
          profile?.default_organization_id ??
          null
        const s =
          profile?.active_site_id ??
          profile?.selected_site_id ??
          profile?.site_id ??
          null
        if (isActive) {
          setOrgId(o)
          setSiteId(s)
        }
      }
      if (isActive) setLoading(false)
    }
    boot()
    return () => { isActive = false }
  }, [router])

  // leads ophalen wanneer preset of range wijzigt
  useEffect(() => {
if (loading) return
    // wacht tot org-scope bekend is (mag null zijn; dan zonder filter)
    // als jouw RLS org verplicht, zal null 0 rijen geven → fallback laat het zien.

    async function fetchLeads(from, to) {
      setFetching(true)

      let q = supabase
        .from("leads")
 .select("id, created_at, company_category, organization_id, site_id")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: true })
      if (orgId) q = q.eq("organization_id", orgId)
      if (siteId) q = q.eq("site_id", siteId)

      let { data: rows, error } = await q
      console.log("[Analytics] rows:", rows?.length ?? "null", "org:", orgId, "site:", siteId, "range:", from.toISOString(), "→", to.toISOString())

      // 🧪 Fallback debug: als 0 rijen en we hebben een orgId, probeer zonder filters om te zien of RLS of filters het blokkeren
      if (!error && rows && rows.length === 0) {
        const { data: testRows, error: tErr } = await supabase
          .from("leads")
          .select("id, created_at, category")
          .gte("created_at", from.toISOString())
          .lte("created_at", to.toISOString())
          .order("created_at", { ascending: true })
        console.log("[Analytics] fallback rows (no org/site filter):", testRows?.length ?? "null", "err:", tErr?.message)
      }


      if (error) {
        console.error("Supabase error:", error)
setChartData([])
setChartData([])
        setCategoryData([])       } else {
        setChartData(groupLeadsAuto(rows || [], from, to))
        setCategoryData(groupCategories(rows || [], 12)) // top 12 categorieën

      }
      setFetching(false)
    }

    fetchLeads(range.from, range.to)
}, [loading, preset, range.from, range.to, orgId, siteId])

  // preset wisselen
  function handlePresetChange(nextPreset) {
    setPreset(nextPreset)
    if (nextPreset === PRESETS.aangepast) {
      setOpenCustom(true) // toon kalender
    } else {
      const r = getRangeForPreset(nextPreset)
      setRange(r)
      setOpenCustom(false)
    }
  }

  // kalenderselectie: zodra 2 datums gekozen -> toepassen
  function handleCalendarSelect(sel) {
    const { from, to } = sel || {}
    if (from && to) {
      const f = startOfDayNL(from)
      const t = endOfDayNL(to)
      setRange({ from: f, to: t })
      setPreset(PRESETS.aangepast)
      setOpenCustom(false)
    }
  }

  // UI labels
  const currentLabel = useMemo(() => {
    switch (preset) {
      case PRESETS.vandaag: return "Vandaag"
      case PRESETS.gisteren: return "Gisteren"
      case PRESETS.dezeWeek: return "Deze week"
      case PRESETS.vorigeWeek: return "Vorige week"
      case PRESETS.vorigeMaand: return "Vorige maand"
      case PRESETS.ditJaar: return "Dit jaar"
      case PRESETS.aangepast: {
        const a = range.from?.toLocaleDateString("nl-NL")
        const b = range.to?.toLocaleDateString("nl-NL")
        return a && b ? `${a} – ${b}` : "Aangepast"
      }
      default: return "Filter"
    }
  }, [preset, range])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-600">Statistieken laden...</p>
      </div>
    )
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Statistieken</h1>
          <p className="text-gray-600">Leads per periode</p>
        </div>

        {/* Preset dropdown + Custom kalender */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="inline-flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                {currentLabel}
                <ChevronDown className="h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Periode</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.vandaag)}>Vandaag</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.gisteren)}>Gisteren</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.dezeWeek)}>Deze week</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.vorigeWeek)}>Vorige week</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.vorigeMaand)}>Vorige maand</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.ditJaar)}>Dit jaar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handlePresetChange(PRESETS.aangepast)}>
                Aangepast…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Losse popover voor het "Aangepast" bereik */}
          <Popover open={openCustom} onOpenChange={setOpenCustom}>
            <PopoverTrigger asChild>
              {/* onzichtbare anchor; we sturen openen via state */}
              <span />
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0">
              <div className="p-3">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={{ from: range.from, to: range.to }}
                  onSelect={handleCalendarSelect}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpenCustom(false)}>Sluiten</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* ✅ Responsive: mobiel onder elkaar, desktop naast elkaar */}
      <div className="flex flex-col gap-6">
  {/* 1) Boven: volle breedte */}
  <BarChartComponent
    title="Leads (auto-groepeerd per dag/maand)"
    data={chartData}
  />

  {/* 2) Onder: links uitgelijnd, niet verbreden */}
  <div className="w-full max-w-xl">
    <BarChartHorizontalComponent
      title="Industrieën (meest voorkomend)"
      data={categoryData}
    />
  </div>
</div>

      {fetching && (
        <p className="mt-3 text-sm text-muted-foreground">Bezig met ophalen…</p>
      )}
    </section>
  )
}
