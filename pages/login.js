// pages/login.js
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()

    const { error } = await supabase.auth.signInWithOtp({ email })

    if (error) {
      setMessage('Er ging iets mis: ' + error.message)
    } else {
      setMessage('Check je e-mail voor een loginlink!')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleLogin} className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h2 className="text-xl font-bold mb-4">Inloggen</h2>
        <input
          type="email"
          placeholder="jouw@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full mb-4"
          required
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded w-full"
        >
          Verstuur magic link
        </button>
        {message && <p className="mt-4 text-center">{message}</p>}
      </form>
    </div>
  )
}