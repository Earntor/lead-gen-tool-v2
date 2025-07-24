import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import ReCAPTCHA from 'react-google-recaptcha'
import PasswordInput from '@/components/PasswordInput'
import Link from 'next/link'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const recaptchaRef = useRef()

  // ✅ Redirect als gebruiker al is ingelogd
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/dashboard')
      }
    })
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const recaptchaToken = await recaptchaRef.current.executeAsync()
      recaptchaRef.current.reset()

      const recaptchaRes = await fetch('/api/verify-recaptcha', {
        method: 'POST',
        body: JSON.stringify({ token: recaptchaToken }),
        headers: { 'Content-Type': 'application/json' },
      })
      const recaptchaData = await recaptchaRes.json()

      if (!recaptchaData.success) {
        setMessage('reCAPTCHA verificatie mislukt.')
        setLoading(false)
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setMessage('Fout bij inloggen: ' + error.message)
        setLoading(false)
        return
      }

      // ✅ Wacht tot de sessie actief is
      const {
        data: { user: loggedInUser },
        error: userError,
      } = await supabase.auth.getUser()

      if (loggedInUser && !userError) {
        router.push('/dashboard')
      } else {
        setMessage('Inloggen mislukt. Probeer opnieuw.')
      }
    } catch (err) {
      console.error('Login fout:', err)
      setMessage('Er ging iets mis. Probeer opnieuw.')
    }

    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleLogin}
        className="bg-white border border-gray-200 p-8 rounded-xl shadow-lg w-full max-w-md space-y-4"
      >
        <h2 className="text-2xl font-bold text-gray-800">Inloggen</h2>

        {message && (
          <p className="text-sm text-center text-red-600">{message}</p>
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
            placeholder="Vul hier je e-mail in"
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Vul hier je wachtwoord in"
          />
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white w-full py-2 rounded font-medium hover:bg-blue-700 transition"
          disabled={loading}
        >
          {loading ? 'Bezig...' : 'Inloggen'}
        </button>

        {/* Invisible reCAPTCHA */}
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
          onClick={handleGoogleLogin}
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
          <span>Log in met Google</span>
        </button>

        <div className="text-sm text-center text-gray-600 mt-4 space-y-2">
          <p>
            Nog geen account?{' '}
            <Link href="/register" className="text-blue-600 hover:underline">
              Registreer hier
            </Link>
          </p>
          <p>
            <Link href="/reset" className="text-blue-600 hover:underline">
              Wachtwoord vergeten?
            </Link>
          </p>
        </div>
      </form>
    </div>
  )
}
