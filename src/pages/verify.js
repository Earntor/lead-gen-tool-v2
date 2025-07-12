import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Verify() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const email = router.query.email

  const handleVerify = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email', // ← voor email-based OTP
    })

    if (error) {
      setError('Verificatie mislukt: ' + error.message)
    } else {
      router.push('/dashboard')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleVerify} className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h2 className="text-xl font-bold mb-4">Voer de code in</h2>
        <p className="text-sm mb-4 text-gray-600">De code is verzonden naar: <strong>{email}</strong></p>
        <input
          type="text"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="border p-2 w-full mb-4"
          maxLength={6}
          required
        />
        <button
          type="submit"
          className={`bg-green-600 text-white px-4 py-2 rounded w-full ${loading ? 'opacity-50' : ''}`}
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Verifieer code'}
        </button>
        {error && <p className="mt-4 text-red-600 text-center">{error}</p>}
      </form>
    </div>
  )
}
