// pages/auth/callback.js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const { error } = await supabase.auth.getSession()

      if (error) {
        console.error('Error during session:', error.message)
      }

      // Redirect naar dashboard
      router.push('/dashboard')
    }

    handleCallback()
  }, [])

  return (
    <p className="text-center mt-20">Je wordt ingelogd...</p>
  )
}
