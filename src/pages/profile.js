import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Profile() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [preferences, setPreferences] = useState({}) // JSON object
  const [message, setMessage] = useState(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()
      if (error || !user) {
        router.replace('/login')
        return
      }

      setUser(user)
      setEmail(user.email)

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, phone, preferences')
        .eq('id', user.id)
        .single()

      if (!profileError && profile) {
        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
        setPreferences(profile.preferences || {})
      }

      setLoading(false)
    }
    fetchUser()
  }, [router])

  const handleUpdate = async () => {
    setUpdating(true)
    setMessage(null)

    try {
      if (email !== user.email) {
        const { error } = await supabase.auth.updateUser({ email })
        if (error) throw error
      }

      const { error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: user.id,
            full_name: fullName,
            phone,
            preferences,
            updated_at: new Date().toISOString(),
          },
          { returning: 'minimal' }
        )

      if (error) throw error

      setMessage({ type: 'success', text: 'Profiel succesvol bijgewerkt' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setUpdating(false)
    }
  }

  const handlePreferenceChange = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }))
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setMessage({ type: 'error', text: 'Vul eerst een geldig e-mailadres in' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Wachtwoord reset e-mail verzonden' })
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return <p className="text-center mt-20">Laden...</p>

  return (
    <div className="max-w-xl mx-auto mt-10 p-4">
      <h1 className="text-2xl font-bold mb-6">Profiel</h1>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.type === 'success'
              ? 'bg-green-200 text-green-800'
              : 'bg-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <label className="block mb-2 font-semibold" htmlFor="email">
        E-mail
      </label>
      <input
        id="email"
        type="email"
        className="w-full mb-4 p-2 border rounded"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label className="block mb-2 font-semibold" htmlFor="fullName">
        Volledige naam
      </label>
      <input
        id="fullName"
        type="text"
        className="w-full mb-4 p-2 border rounded"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />

      <label className="block mb-2 font-semibold" htmlFor="phone">
        Telefoonnummer
      </label>
      <input
        id="phone"
        type="tel"
        className="w-full mb-4 p-2 border rounded"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <fieldset className="mb-4">
        <legend className="font-semibold mb-2">Voorkeuren</legend>
        <label className="block mb-2">
          <input
            type="checkbox"
            checked={preferences.emailNotifications || false}
            onChange={(e) =>
              handlePreferenceChange('emailNotifications', e.target.checked)
            }
          />{' '}
          E-mail notificaties ontvangen
        </label>
        {/* Voeg hier eventueel meer voorkeuren toe */}
      </fieldset>

      <button
        onClick={handleUpdate}
        disabled={updating}
        className="bg-blue-600 text-white px-4 py-2 rounded mb-4 disabled:opacity-50"
      >
        {updating ? 'Bezig...' : 'Profiel bijwerken'}
      </button>

      <hr className="my-6" />

      <button
        onClick={handlePasswordReset}
        className="bg-yellow-500 text-white px-4 py-2 rounded mb-4"
      >
        Wachtwoord reset e-mail versturen
      </button>

      <hr className="my-6" />

      <button
        onClick={handleLogout}
        className="bg-red-600 text-white px-4 py-2 rounded"
      >
        Uitloggen
      </button>
    </div>
  )
}
