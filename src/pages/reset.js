import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function ResetPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleReset = async (e) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    })

    if (error) {
      setMessage('Fout bij versturen: ' + error.message)
    } else {
      setMessage('Check je e-mail voor een reset-link.')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleReset}
        className="bg-white border border-gray-200 p-8 rounded-xl shadow-lg w-full max-w-md space-y-4"
      >
        <h2 className="text-2xl font-bold text-gray-800">Wachtwoord vergeten</h2>

        <div>
          <label htmlFor="email" className="block text-sm text-gray-700 mb-1">
            E-mailadres
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-gray-300 rounded w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {message && (
          <p className="text-sm text-center text-red-600">{message}</p>
        )}

        <button
          type="submit"
          className="bg-blue-600 text-white w-full py-2 rounded font-medium hover:bg-blue-700 transition"
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Verstuur reset-link'}
        </button>
      </form>
    </div>
  )
}
