import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function ConfirmEmail() {
  const [message, setMessage] = useState('Je wordt bevestigd...')
  const router = useRouter()

  useEffect(() => {
    const confirmEmail = async () => {
      const { error } = await supabase.auth.exchangeCodeForSession()

      if (error) {
        console.error(error)
        setMessage('Fout bij bevestigen: ' + error.message)
      } else {
        setMessage('Bevestiging gelukt! Je wordt doorgestuurd...')
        setTimeout(() => router.push('/dashboard'), 2000)
      }
    }

    confirmEmail()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-sm text-center">
        <p>{message}</p>
      </div>
    </div>
  )
}
