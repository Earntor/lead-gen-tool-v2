import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function UpdatePassword() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleUpdate = async (e) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setMessage('Fout bij wachtwoord reset: ' + error.message)
    } else {
      setMessage('Wachtwoord is bijgewerkt. Je wordt doorgestuurd...')
      setTimeout(() => router.push('/login'), 2000)
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleUpdate} className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h2 className="text-xl font-bold mb-4">Nieuw wachtwoord instellen</h2>

        <input
          type="password"
          placeholder="Nieuw wachtwoord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full mb-4"
          required
        />

        <button
          type="submit"
          className="bg-green-600 text-white px-4 py-2 rounded w-full"
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Stel wachtwoord in'}
        </button>

        {message && <p className="mt-4 text-center">{message}</p>}
      </form>
    </div>
  )
}
