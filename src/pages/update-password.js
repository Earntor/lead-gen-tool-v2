import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import PasswordInput from '@/components/PasswordInput'

export default function UpdatePassword() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const getPasswordStrength = (pwd) => {
    if (pwd.length < 6) return { label: 'Zwak', color: 'bg-red-500' }
    if (pwd.length < 10) return { label: 'Gemiddeld', color: 'bg-yellow-500' }
    return { label: 'Sterk', color: 'bg-green-500' }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setMessage('Fout bij wachtwoord reset: ' + error.message)
    } else {
      setMessage('Wachtwoord is bijgewerkt. Je wordt doorgestuurd...')
      setTimeout(() => router.push('/login'), 2000)
    }

    setLoading(false)
  }

  const strength = getPasswordStrength(password)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleUpdate}
        className="bg-white border border-gray-200 p-8 rounded-xl shadow-lg w-full max-w-md space-y-4"
      >
        <h2 className="text-2xl font-bold text-gray-800">Nieuw wachtwoord instellen</h2>

        <div>
          <label htmlFor="password" className="block text-sm text-gray-700 mb-1">
            Nieuw wachtwoord
          </label>
          <PasswordInput
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 rounded w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />

          {password && (
            <div className="mt-2">
              <div className="h-2 rounded bg-gray-200">
                <div
                  className={`h-2 rounded ${strength.color}`}
                  style={{ width: `${Math.min(password.length * 10, 100)}%` }}
                ></div>
              </div>
              <p className="text-xs mt-1 text-gray-600">{strength.label}</p>
            </div>
          )}
        </div>

        {message && (
          <p className="text-sm text-center text-red-600">{message}</p>
        )}

        <button
          type="submit"
          className="bg-blue-600 text-white w-full py-2 rounded font-medium hover:bg-blue-700 transition"
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Stel wachtwoord in'}
        </button>
      </form>
    </div>
  )
}
