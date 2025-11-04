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

// Zelfde als groupLeadsAuto maar met een datumselector (created_at/timestamp)
function groupLeadsAutoBy(rows, from, to, dateSelector) {
  const days = diffDays(from, to)
  if (days <= 31) {
    // per dag
    const buckets = new Map(eachDayRange(from, to).map(d => [fmtDay(d), 0]))
    for (const r of rows) {
      const iso = dateSelector(r)
      if (!iso) continue
      const dt = new Date(iso)
      const key = fmtDay(dt)
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
    }
    return Array.from(buckets, ([name, value]) => ({ name, value }))
  } else {
    // per maand
    const months = eachMonthRange(from, to)
    const buckets = new Map(months.map(d => [fmtMonth(d), 0]))
    for (const r of rows) {
      const iso = dateSelector(r)
      if (!iso) continue
      const dt = new Date(iso)
      const key = fmtMonth(new Date(dt.getFullYear(), dt.getMonth(), 1))
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
    }
    return Array.from(buckets, ([name, value]) => ({ name, value }))
  }
}

// Categorie-telling met keySelector (category_nl → category → Onbekend)
function groupCategoriesBy(rows, topN = 12, keySelector) {
  const map = new Map()
  for (const r of rows || []) {
    const key = keySelector(r) || "Onbekend"
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

function mergeUniqueById(a = [], b = []) {
  const map = new Map()
  for (const r of a) map.set(r.id, r)
  for (const r of b) if (!map.has(r.id)) map.set(r.id, r)
  return Array.from(map.values())
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
const [userId, setUserId] = useState(null)
const [customOpen, setCustomOpen] = useState(false) // toont inline kalenderpaneel
const [tempRange, setTempRange] = useState({ from: null, to: null }) // tijdelijke selectie
  // filter state
const [preset, setPreset] = useState(PRESETS.dezeWeek)
  const initialRange = getRangeForPreset(PRESETS.dezeWeek)
  const [range, setRange] = useState({ from: initialRange.from, to: initialRange.to })

  // data
const [chartData, setChartData] = useState([])
const [categoryData, setCategoryData] = useState([])
const [fetching, setFetching] = useState(false)

  // auth
  useEffect(() => {
  let isActive = true
  async function boot() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace("/login?next=/analytics")
      return
    }
    if (isActive) setUserId(user.id)
    if (isActive) setLoading(false)
  }
  boot()
  return () => { isActive = false }
}, [router])


  // leads ophalen wanneer preset of range wijzigt
  // leads ophalen wanneer preset of range wijzigt
// leads ophalen wanneer preset of range wijzigt
// ✔ Helper: zet RPC-rijen om naar velden die je bestaande group-functies snappen
function adaptForGrouping(rows) {
  // RPC retourneert: id, lead_dt (ISO), cat (tekst / null)
  return (rows || []).map(r => ({
    id: r.id,
    created_at: r.lead_dt,  // voor groupLeadsAuto (tijd-as)
    category: r.cat,        // ruwe categorie (EN/NL)
    category_nl: r.cat      // we mappen NL=cat; jij gebruikt toch label in chart
  }))
}

useEffect(() => {
  if (loading || !userId) return

  async function fetchLeads(from, to) {
    setFetching(true)

    const { data, error } = await supabase.rpc("leads_analytics_range", {
      p_user: userId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    })

    if (error) {
      console.error("RPC error (leads_analytics_range):", error)
      setChartData([])
      setCategoryData([])
      setFetching(false)
      return
    }

    const rows = adaptForGrouping(data)

    // 1) Tijd-as (dag/maand automatisch)
    setChartData(groupLeadsAuto(rows, from, to))

    // 2) Categorie-balk (top 12, aflopend). We pakken NL-label op basis van category_nl → category → Onbekend
    setCategoryData(
      groupCategoriesBy(rows, 12, r => (r.category_nl?.trim() || r.category?.trim() || "Onbekend"))
    )

    setFetching(false)
  }

  fetchLeads(range.from, range.to)
}, [loading, userId, preset, range.from, range.to])

  // preset wisselen
  function handlePresetChange(nextPreset) {
    setPreset(nextPreset)
    if (nextPreset !== PRESETS.aangepast) {
      const r = getRangeForPreset(nextPreset)
      setRange(r)
      setMenuOpen(false)
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
         <DropdownMenu open={menuOpen} onOpenChange={(o) => { setMenuOpen(o); if (!o) setCustomOpen(false) }}>
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
              {/* Aangepast…: houd menu open en toon inline paneel */}
  <DropdownMenuItem
    onSelect={(e) => { e.preventDefault(); setCustomOpen(v => !v); setTempRange({ from: range.from ?? null, to: range.to ?? null }) }}
  >
    Aangepast…
  </DropdownMenuItem>

  {/* Inline kalenderpaneel direct onder het item */}
  {customOpen && (
    <div className="mt-1 border-t">
      <div className="p-3">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={{ from: tempRange.from || undefined, to: tempRange.to || undefined }}
          onSelect={(sel) => {
            const from = sel?.from ?? null
            const to = sel?.to ?? null
            setTempRange({ from, to })
            if (from && to) {
              const f = startOfDayNL(from)
              const t = endOfDayNL(to)
              setRange({ from: f, to: t })
              setPreset(PRESETS.aangepast)
              setMenuOpen(false)   // hele menu sluiten na complete range
              setCustomOpen(false) // paneel dicht
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="pr-2">
            {tempRange.from && tempRange.to
              ? `${tempRange.from.toLocaleDateString("nl-NL")} – ${tempRange.to.toLocaleDateString("nl-NL")}`
              : tempRange.from
                ? `${tempRange.from.toLocaleDateString("nl-NL")} – …`
                : "Kies een begin- en einddatum"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setTempRange({ from: null, to: null }) }}
              disabled={!tempRange.from && !tempRange.to}
            >
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setCustomOpen(false) }}
            >
              Sluiten
            </Button>
          </div>
        </div>
      </div>
    </div>
  )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ✅ Responsive: mobiel onder elkaar, desktop naast elkaar */}
      <div className="flex flex-col gap-6">
  {/* 1) Boven: volle breedte */}
  <BarChartComponent
    title="Leads"
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
