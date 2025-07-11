// pages/dashboard.js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Dashboard() {
  const router = useRouter()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const getUserAndLeads = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUser(user)

      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', user.id)
        .order('timestamp', { ascending: false })

      if (error) {
        console.error(error)
      } else {
        setLeads(data)
      }

      setLoading(false)
    }

    getUserAndLeads()
  }, [])

  if (loading) return <p className="text-center mt-20">Laden...</p>

  return (
    <div className="max-w-4xl mx-auto mt-10 p-4">
      <h1 className="text-2xl font-bold mb-6">Welkom, {user?.email}</h1>
      <h2 className="text-xl mb-4">Je leads:</h2>
      {leads.length === 0 ? (
        <p>Geen leads gevonden.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-200">
              <th className="border p-2">IP-adres</th>
              <th className="border p-2">Bedrijf</th>
              <th className="border p-2">Pagina</th>
              <th className="border p-2">Datum</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-gray-50">
                <td className="border p-2">{lead.ip_address}</td>
                <td className="border p-2">{lead.company_name || '-'}</td>
                <td className="border p-2">{lead.page_url}</td>
                <td className="border p-2">{new Date(lead.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
