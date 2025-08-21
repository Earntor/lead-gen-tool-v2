import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import { supabase } from "../lib/supabaseClient"

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const checkSessionAndTrackLead = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Profiel + organisatie ophalen
        const { data: profile } = await supabase
          .from("profiles")
          .select("current_org_id")
          .eq("id", user.id)
          .single()

        if (!profile?.current_org_id) {
          console.error("Geen organisatie gevonden voor deze gebruiker")
          setChecking(false)
          return
        }

        const org_id = profile.current_org_id
        const page_url = window.location.pathname

        try {
          const ipRes = await fetch("https://api.ipify.org?format=json")
          const ipData = await ipRes.json()
          const ip_address = ipData.ip

          // Lead loggen met ORG i.p.v. USER
          await fetch("/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ org_id, ip_address, page_url }),
          })
        } catch (err) {
          console.error("Fout bij lead tracking:", err)
        }

        router.replace("/dashboard")
      } else {
        setChecking(false)
      }
    }

    checkSessionAndTrackLead()
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Even controleren...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">Welkom bij de Lead Gen Tool 👋</h1>
      <p className="mb-6 text-gray-600">Start door in te loggen of een account aan te maken.</p>
      <div className="flex gap-4">
        <a href="/login" className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800">
          Inloggen
        </a>
        <a href="/register" className="px-4 py-2 bg-gray-200 text-black rounded hover:bg-gray-300">
          Registreren
        </a>
      </div>
    </div>
  )
}
