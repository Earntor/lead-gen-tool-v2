import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import Image from "next/image"
import { Geist, Geist_Mono } from "next/font/google"
import { supabase } from "../lib/supabaseClient"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const checkSessionAndTrackLead = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data?.session

      if (session) {
        const user_id = session.user.id
        const page_url = window.location.pathname

        try {
          const ipRes = await fetch('https://api.ipify.org?format=json')
          const ipData = await ipRes.json()
          const ip_address = ipData.ip

          await fetch('/api/lead', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id, ip_address, page_url }),
          })
        } catch (err) {
          console.error('Fout bij lead tracking:', err)
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
    <div
      className={`${geistSans.className} ${geistMono.className} grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20`}
    >
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={180}
          height={38}
          priority
        />
        <ol className="list-inside list-decimal text-sm/6 text-center sm:text-left">
          <li className="mb-2 tracking-[-.01em]">
            Je bent op de homepage van je project.
          </li>
          <li className="tracking-[-.01em]">Beveiligde toegang wordt automatisch geregeld.</li>
        </ol>
      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        <a
          className="hover:underline"
          href="https://nextjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by Next.js
        </a>
      </footer>
    </div>
  )
}
