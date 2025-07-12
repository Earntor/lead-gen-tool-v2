// src/pages/auth/callback.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const { error } = await supabase.auth.getSession()

      if (error) {
        console.error('Fout bij sessie ophalen:', error.message)
      }

      router.push('/dashboard') // Verander dit indien gewenst
    }

    handleCallback()
  }, [])

  return <p className="text-center mt-20">Je wordt ingelogd...</p>
}
