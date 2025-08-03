import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import dynamic from 'next/dynamic'
import PasswordInput from '../components/PasswordInput'
import Link from 'next/link'

const ReCAPTCHA = dynamic(() => import('react-google-recaptcha'), { ssr: false })

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [recaptchaToken, setRecaptchaToken] = useState(null)
  const recaptchaRef = useRef(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setMessage('')
    setLoading(true)

    if (!recaptchaRef.current) {
      setMessage('❌ reCAPTCHA is nog niet geladen.')
      setLoading(false)
      return
    }

    // Trigger reCAPTCHA (de rest gaat via onChange)
    recaptchaRef.current.reset()
    recaptchaRef.current.execute()
  }

  const onRecaptchaChange = async (token) => {
    if (!token) {
      setMessage('❌ reCAPTCHA gaf geen token terug.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/verify-recaptcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()
      if (!data.success) {
        setMessage('reCAPTCHA verificatie mislukt.')
        setLoading(false)
        return
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage('Fout bij inloggen: ' + error.message)
        setLoading(false)
        return
      }

      router.push('/dashboard')
    } catch (err) {
      console.error('❌ Verificatie fout:', err)
      setMessage('Er ging iets mis. Probeer opnieuw.')
    } finally {
      setLoading(false)
    }
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

        {message && <p className="text-sm text-center text-red-600">{message}</p>}

        <div>
          <label htmlFor="email" className="block text-sm text-gray-700 mb-1">E-mailadres</label>
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
          <label htmlFor="password" className="block text-sm text-gray-700 mb-1">Wachtwoord</label>
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

        {/* ✅ Invisible reCAPTCHA */}
        <ReCAPTCHA
          ref={recaptchaRef}
          sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
          size="invisible"
          badge="bottomright"
          onChange={onRecaptchaChange}
          onErrored={() => {
            setMessage('❌ reCAPTCHA fout. Ververs de pagina.')
          }}
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
          <svg className="w-5 h-5" viewBox="0 0 533.5 544.3">
            <path d="M533.5 278.4c0-17.4-1.5-34-4.4-50H272v94.8h146.9..." fill="#4285f4" />
            {/* overige path ingekort */}
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
