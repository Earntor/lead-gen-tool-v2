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

  const companies = [...new Map(leads.map((lead) => [lead.company_name, lead])).values()]
  const filteredActivities = leads.filter((l) => l.company_name === selectedCompany)

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
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto mt-10 p-4 text-gray-800">
      {/* Header met dropdown */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="relative group">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border rounded shadow-sm hover:shadow-md transition">
            <span className="font-medium text-sm">{user?.email}</span>
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className="absolute right-0 mt-2 hidden group-hover:block bg-white border rounded shadow-md w-48 z-10">
            <a href="/instellingen" className="block px-4 py-2 text-sm hover:bg-gray-100">Instellingen</a>
            <a href="/facturen" className="block px-4 py-2 text-sm hover:bg-gray-100">Facturen</a>
            <a href="/betaalmethoden" className="block px-4 py-2 text-sm hover:bg-gray-100">Betaalmethoden</a>
            <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-100">Uitloggen</button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Bedrijvenlijst */}
        <div className="border rounded p-4 bg-white shadow">
          <h2 className="text-lg font-semibold mb-4">Bezoekende bedrijven</h2>
          <ul className="space-y-2">
            {companies.map((company) => (
              <li
                key={company.company_name}
                onClick={() => {
                  setSelectedCompany(company.company_name)
                  setInitialVisitorSet(false)
                }}
                className={`cursor-pointer p-2 rounded flex items-center gap-2 hover:bg-gray-100 ${
                  selectedCompany === company.company_name ? 'bg-blue-100' : ''
                }`}
              >
                {company.company_domain && (
                  <img
                    src={`https://img.logo.dev/${company.company_domain}?token=pk_R_r8ley_R_C7tprVCpFASQ`}
                    alt="logo"
                    className="w-5 h-5 object-contain"
                    onError={(e) => (e.target.style.display = 'none')}
                  />
                )}
                <span className="text-sm font-medium">{company.company_name}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Activiteiten en informatie */}
        <div className="md:col-span-2 border rounded p-4 bg-white shadow">
          {selectedCompany ? (
            <>
              <h2 className="text-lg font-semibold mb-4">Activiteiten – {selectedCompany}</h2>

              {sortedVisitors.length === 0 ? (
                <p>Geen activiteiten gevonden.</p>
              ) : (
                <div className="space-y-4">
                  {sortedVisitors.map(([visitorId, sessions], index) => {
                    const isOpen = openVisitors.has(visitorId)
                    return (
                      <div key={visitorId} className="border rounded">
                        <div
                          onClick={() => toggleVisitor(visitorId)}
                          className="cursor-pointer px-4 py-2 bg-gray-100 hover:bg-gray-200 flex justify-between items-center"
                        >
                          <span className="text-sm font-semibold text-gray-800">Bezoeker {index + 1}</span>
                          <span className="text-gray-500">{isOpen ? '▲' : '▼'}</span>
                        </div>

                        {isOpen && (
                          <table className="min-w-full text-sm text-left">
                            <thead className="bg-gray-50 border-b text-gray-600">
                              <tr>
                                <th className="p-2">Pagina</th>
                                <th className="p-2">Tijdstip</th>
                                <th className="p-2">Duur (sec)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sessions.map((item, i) => (
                                <tr
                                  key={item.id}
                                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                                >
                                  <td className="p-2">{item.page_url}</td>
                                  <td className="p-2">{new Date(item.timestamp).toLocaleString()}</td>
                                  <td className="p-2">{item.duration_seconds ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Bedrijfsinformatie */}
              {filteredActivities.length > 0 && (
                <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded">
                  <h3 className="text-lg font-semibold mb-2">Bedrijfsinformatie</h3>
                  <ul className="space-y-1 text-sm">
                    <li><strong>Naam:</strong> {filteredActivities[0].company_name}</li>
                    <li><strong>Locatie:</strong> {filteredActivities[0].location || 'Onbekend'}</li>
                    {filteredActivities[0].company_domain && (
                      <li>
                        <strong>Website:</strong>{' '}
                        <a href={`https://${filteredActivities[0].company_domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                          {filteredActivities[0].company_domain}
                        </a>
                      </li>
                    )}
                    <li>
                      <strong>LinkedIn:</strong>{' '}
                      {filteredActivities[0].linkedin_url ? (
                        <a href={filteredActivities[0].linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                          Bedrijf op LinkedIn
                        </a>
                      ) : (
                        <a
                          href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(filteredActivities[0].company_name || '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline"
                        >
                          Zoek op LinkedIn
                        </a>
                      )}
                    </li>
                    {filteredActivities[0].kvk_number && (
                      <>
                        <li><strong>KvK-nummer:</strong> {filteredActivities[0].kvk_number}</li>
                        <li><strong>Adres:</strong> {filteredActivities[0].kvk_street}, {filteredActivities[0].kvk_postal_code} {filteredActivities[0].kvk_city}</li>
                      </>
                    )}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>Selecteer een bedrijf om activiteiten te bekijken.</p>
          )}
        </div>
      </div>
    </div>
  )
}
