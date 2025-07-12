import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [leads, setLeads] = useState([])
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openVisitors, setOpenVisitors] = useState(new Set())
  const [initialVisitorSet, setInitialVisitorSet] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('alles')
  const [customRange, setCustomRange] = useState({ from: '', to: '' })

  useEffect(() => {
    const getUserAndLeads = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (!user || error) {
        router.replace('/login')
        return
      }

      setUser(user)

      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('*')
        .not('company_name', 'is', null)
        .order('timestamp', { ascending: false })

      if (leadsError) {
        console.error('Fout bij ophalen leads:', leadsError.message)
      } else {
        setLeads(leadsData)
      }

      setLoading(false)
    }

    getUserAndLeads()
  }, [router])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const isInDateRange = (dateStr) => {
    const date = new Date(dateStr)
    switch (filterType) {
      case 'vandaag':
        return date >= today
      case 'gisteren':
        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)
        return date >= yesterday && date < today
      case 'deze-week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - today.getDay())
        return date >= weekStart
      case 'vorige-week':
        const prevWeekStart = new Date(today)
        prevWeekStart.setDate(today.getDate() - today.getDay() - 7)
        const prevWeekEnd = new Date(prevWeekStart)
        prevWeekEnd.setDate(prevWeekStart.getDate() + 6)
        return date >= prevWeekStart && date <= prevWeekEnd
      case 'vorige-maand':
        const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
        const firstOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        return date >= firstOfPrevMonth && date < firstOfThisMonth
      case 'dit-jaar':
        const janFirst = new Date(today.getFullYear(), 0, 1)
        return date >= janFirst
      case 'aangepast':
        return (
          new Date(dateStr) >= new Date(customRange.from) &&
          new Date(dateStr) <= new Date(customRange.to)
        )
      default:
        return true
    }
  }

  // 1. Filter leads op datum
  const filteredLeads = leads.filter((l) => isInDateRange(l.timestamp))

  // 2. Filter bedrijven op basis van gefilterde leads
  const companies = [
    ...new Map(
      filteredLeads.map((lead) => [lead.company_name, lead])
    ).values(),
  ]

  // 3. Filter activiteiten op bedrijf
  const filteredActivities = filteredLeads.filter(
    (l) => l.company_name === selectedCompany
  )

  useEffect(() => {
    if (!selectedCompany || filteredActivities.length === 0 || initialVisitorSet) return

    const grouped = filteredActivities.reduce((acc, activity) => {
      const key = activity.anon_id || `onbekend-${activity.id}`
      acc[key] = acc[key] || []
      acc[key].push(activity)
      return acc
    }, {})

    const sorted = Object.entries(grouped).sort((a, b) => {
      const lastA = new Date(a[1][0].timestamp)
      const lastB = new Date(b[1][0].timestamp)
      return lastB - lastA
    })

    if (sorted.length > 0) {
      const latestVisitorKey = sorted[0][0]
      setOpenVisitors(new Set([latestVisitorKey]))
      setInitialVisitorSet(true)
    }
  }, [selectedCompany, filteredActivities, initialVisitorSet])

  const toggleVisitor = (visitorId) => {
    setOpenVisitors((prev) => {
      const newSet = new Set(prev)
      newSet.has(visitorId) ? newSet.delete(visitorId) : newSet.add(visitorId)
      return new Set([...newSet])
    })
  }

  const groupedByVisitor = filteredActivities.reduce((acc, activity) => {
    const key = activity.anon_id || `onbekend-${activity.id}`
    acc[key] = acc[key] || []
    acc[key].push(activity)
    return acc
  }, {})

  const sortedVisitors = Object.entries(groupedByVisitor).sort((a, b) => {
    const lastA = new Date(a[1][0].timestamp)
    const lastB = new Date(b[1][0].timestamp)
    return lastB - lastA
  })

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-accent"></div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <header className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
        <div className="relative group">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition">
            <span className="text-sm font-medium text-gray-700">{user?.email}</span>
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className="absolute right-0 mt-2 z-10 hidden group-hover:block bg-white border rounded-lg shadow-md w-48">
            <a href="/instellingen" className="block px-4 py-2 text-sm hover:bg-gray-50">Instellingen</a>
            <a href="/facturen" className="block px-4 py-2 text-sm hover:bg-gray-50">Facturen</a>
            <a href="/betaalmethoden" className="block px-4 py-2 text-sm hover:bg-gray-50">Betaalmethoden</a>
            <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-100">Uitloggen</button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Filter */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Filter op datum</h2>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full mb-4 border border-gray-300 rounded-md px-3 py-2 shadow-sm text-sm focus:ring-accent"
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

          {filterType === 'aangepast' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm block mb-1 text-gray-600">Van:</label>
                <input
                  type="date"
                  value={customRange.from}
                  onChange={(e) =>
                    setCustomRange((prev) => ({ ...prev, from: e.target.value }))
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-sm block mb-1 text-gray-600">Tot:</label>
                <input
                  type="date"
                  value={customRange.to}
                  onChange={(e) =>
                    setCustomRange((prev) => ({ ...prev, to: e.target.value }))
                  }
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>

        {/* Bedrijvenlijst */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Bezoekende bedrijven</h2>

          <input
            type="text"
            placeholder="Zoek bedrijf..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-4 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-2 focus:ring-accent"
          />

          <ul className="space-y-2">
            {companies
              .filter((c) =>
                c.company_name.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map((company) => (
                <li
                  key={company.company_name}
                  onClick={() => {
                    setSelectedCompany(company.company_name)
                    setInitialVisitorSet(false)
                  }}
                  className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-md transition ${
                    selectedCompany === company.company_name
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  {company.company_domain && (
                    <img
                      src={`https://img.logo.dev/${company.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
                      alt="logo"
                      className="w-5 h-5 object-contain rounded-sm"
                      onError={(e) => (e.target.style.display = 'none')}
                    />
                  )}
                  <span>{company.company_name}</span>
                </li>
              ))}
          </ul>
        </div>

        {/* Activiteiten + bedrijfsinfo */}
        <div className="md:col-span-2 space-y-6">
          {selectedCompany ? (
            <>
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold mb-4 text-gray-800">
                  Activiteiten – {selectedCompany}
                </h2>

                {sortedVisitors.length === 0 ? (
                  <p className="text-sm text-gray-500">Geen activiteiten gevonden.</p>
                ) : (
                  sortedVisitors.map(([visitorId, sessions], index) => {
                    const isOpen = openVisitors.has(visitorId)
                    return (
                      <div key={visitorId} className="border-t pt-4">
                        <button
                          onClick={() => toggleVisitor(visitorId)}
                          className="flex justify-between w-full text-left font-medium text-sm text-gray-700 hover:text-accent"
                        >
                          Bezoeker {index + 1}
                          <span>{isOpen ? '▲' : '▼'}</span>
                        </button>
                        {isOpen && (
                          <table className="w-full mt-3 text-sm border-t">
                            <thead className="text-gray-500">
                              <tr>
                                <th className="py-2 text-left">Pagina</th>
                                <th className="py-2 text-left">Tijdstip</th>
                                <th className="py-2 text-left">Duur</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sessions.map((item) => (
                                <tr key={item.id} className="border-t hover:bg-gray-50">
                                  <td className="py-2">{item.page_url}</td>
                                  <td className="py-2">
                                    {new Date(item.timestamp).toLocaleString()}
                                  </td>
                                  <td className="py-2">{item.duration_seconds ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div className="bg-white p-6 rounded-xl border text-gray-500 shadow-sm">
              Selecteer een bedrijf om activiteiten te bekijken.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
