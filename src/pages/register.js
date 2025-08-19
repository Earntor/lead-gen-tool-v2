// src/pages/register.js
import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useRouter } from 'next/router'
import PasswordInput from '../components/PasswordInput'
import dynamic from 'next/dynamic'
const ReCAPTCHA = dynamic(() => import('react-google-recaptcha'), { ssr: false })
import Link from 'next/link'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const recaptchaRef = useRef()

  // Invite e-mail alvast invullen (maar veld blijft bewerkbaar)
  useEffect(() => {
    if (router.isReady && router.query.email) {
      setEmail(router.query.email)
    }
  }, [router.isReady, router.query.email])

  const getPasswordStrength = (pwd) => {
    if (pwd.length < 6) return { label: 'Zwak', color: 'bg-red-500' }
    if (pwd.length < 10) return { label: 'Gemiddeld', color: 'bg-yellow-500' }
    return { label: 'Sterk', color: 'bg-green-500' }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    // Bouw de redirect met invite/next params
const params = new URLSearchParams()
if (router.query?.invite) params.set('invite', router.query.invite)
if (router.query?.next) params.set('next', router.query.next)

const redirectUrl = `${window.location.origin}/auth/callback${
  params.toString() ? '?' + params.toString() : ''
}`

const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: redirectUrl,
  },
})

    if (error) {
      if (
        error.message.includes('already registered') ||
        error.message.includes('User already registered')
      ) {
        setMessage(
          'Dit e-mailadres is al geregistreerd. Probeer in te loggen of reset je wachtwoord.'
        )
      } else {
        setMessage('Fout bij registreren: ' + error.message)
      }
      setLoading(false)
      return
    }

    setMessage('Registratie gelukt! Bevestig je e-mail via de link in je inbox.')

    // 👉 Invite-token niet hier accepteren (werkt pas als user ingelogd is).
    // Gewoon redirecten naar de juiste pagina.
    const next = router.query?.next
    if (next && next.startsWith('/')) {
      router.replace(next) // stuurt terug naar /invite/accept?token=...
    } else {
      router.replace('/dashboard')
    }

    setLoading(false)
  }

  const handleGoogleSignUp = async () => {
    const next = router.query?.next
    const invite = router.query?.invite
    const params = new URLSearchParams()
    if (next) params.set('next', next)
    if (invite) params.set('invite', invite)

    const redirectUrl = `${window.location.origin}/auth/callback${
      params.toString() ? '?' + params.toString() : ''
    }`

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl },
    })

    if (error) setMessage('Fout bij Google sign-up: ' + error.message)
  }

  const strength = getPasswordStrength(password)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleRegister}
        className="bg-white border border-gray-200 p-8 rounded-xl shadow-lg w-full max-w-md space-y-4"
      >
        <h2 className="text-2xl font-bold text-gray-800">Account aanmaken</h2>

        {message && (
          <p
            className={`text-sm text-center ${
              message.startsWith('Registratie gelukt')
                ? 'text-green-700'
                : 'text-red-600'
            }`}
          >
            {message}
          </p>
        )}

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

        <div>
          <label htmlFor="password" className="block text-sm text-gray-700 mb-1">
            Wachtwoord
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

        <button
          type="submit"
          className="bg-blue-600 text-white w-full py-2 rounded font-medium hover:bg-blue-700 transition"
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Registreren'}
        </button>
        <ReCAPTCHA
          ref={recaptchaRef}
          sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
          size="invisible"
        />

        <div className="flex items-center gap-2 my-4">
          <hr className="flex-grow border-gray-300" />
          <span className="text-gray-500 text-sm">of</span>
          <hr className="flex-grow border-gray-300" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignUp}
          className="w-full border border-gray-300 bg-white text-gray-700 font-medium py-2 rounded flex items-center justify-center gap-2 hover:bg-gray-50 transition"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 533.5 544.3"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M533.5 278.4c0-17.4-1.5-34-4.4-50H272v94.8h146.9c-6.4 34.6-25.7 63.9-54.8 83.6v69.4h88.4c51.7-47.7 81-118.1 81-197.8z"
              fill="#4285f4"
            />
            <path
              d="M272 544.3c73.5 0 135.2-24.4 180.3-66.3l-88.4-69.4c-24.5 16.4-56 26-91.9 26-70.7 0-130.6-47.7-152-111.6H30.3v70.5C75 482.2 167.3 544.3 272 544.3z"
              fill="#34a853"
            />
            <path
              d="M120 323c-10.2-30.6-10.2-63.5 0-94.1V158.4H30.3c-42.9 85.6-42.9 186.1 0 271.7L120 323z"
              fill="#fbbc04"
            />
            <path
              d="M272 107.3c38.9-.6 76.1 13.9 104.3 39.7l78.1-78.1C405.8 24.9 340.8 0 272 0 167.3 0 75 62.1 30.3 158.4l89.7 70.5c21.3-63.9 81.3-111.6 152-111.6z"
              fill="#ea4335"
            />
          </svg>
          <span>Registreer met Google</span>
        </button>

        <p className="text-sm text-center text-gray-600 mt-4">
          Heb je al een account?{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            Log dan hier in
          </Link>
        </p>
        <p className="text-sm text-center text-gray-600 mt-2">
          Wachtwoord vergeten?{" "}
          <Link href="/reset-password" className="text-blue-600 hover:underline">
            Reset hier
          </Link>
        </p>
      </form>
    </div>
  )
}
