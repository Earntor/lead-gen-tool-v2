import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function Account() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('account')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [preferences, setPreferences] = useState({})
  const [generalMessage, setGeneralMessage] = useState(null)
  const [trackingMessage, setTrackingMessage] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [copySuccess, setCopySuccess] = useState('')
  const [trackingScript, setTrackingScript] = useState('')
  const [lastTrackingPing, setLastTrackingPing] = useState(null);
  
  
  const getTrackingStatusBadge = () => {
  if (!lastTrackingPing) {
    return (
      <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium">
        Geen ping
      </span>
    );
  }

  const diff = new Date() - new Date(lastTrackingPing);

  if (diff > 1000 * 60 * 60 * 24) {
    return (
      <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium">
        Inactief
      </span>
    );
  }

  return (
    <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium">
      Actief
    </span>
  );
};



  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) {
        router.replace('/login')
        return
      }
      setUser(user)
      setEmail(user.email)

      const { data: profile } = await supabase
  .from('profiles')
  .select('full_name, phone, preferences, last_tracking_ping')
  .eq('id', user.id)
  .single()


      if (profile) {
        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
         setPreferences(profile.preferences || {});
  setLastTrackingPing(profile.last_tracking_ping || null);
      }

      const domain = process.env.NEXT_PUBLIC_TRACKING_DOMAIN || window.location.origin
      const script = `<script src="${domain}tracker.js" data-project-id="${user.id}" async></script>`
      setTrackingScript(script)

      setLoading(false)
    }
    fetchUser()
  }, [router])

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash) {
  setActiveTab(hash)
  onHashChange() // ⬅️ Laad meteen de juiste tab-actie
}

    const onHashChange = () => {
  const newHash = window.location.hash.replace('#', '')
  setActiveTab(newHash || 'account')
  setGeneralMessage(null)
  setTrackingMessage(null)

  // ✅ Als tracking-tab wordt geopend: herlaad tracking ping
  if ((newHash || 'account') === 'tracking' && user?.id) {
    supabase
      .from('profiles')
      .select('last_tracking_ping')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.last_tracking_ping) {
          setLastTrackingPing(data.last_tracking_ping)
        }
      })
  }
}

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

    useEffect(() => {
    const interval = setInterval(async () => {
      if (!user?.id) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('last_tracking_ping')
        .eq('id', user.id)
        .single();

      if (data?.last_tracking_ping) {
        setLastTrackingPing(data.last_tracking_ping);
      }
    }, 1000 * 60 * 5); // Elke 5 minuten

    return () => clearInterval(interval); // Opruimen als component sluit
  }, [user]);


  const handleUpdate = async () => {
    setUpdating(true)
    setGeneralMessage(null)
    try {
      if (email !== user.email) {
        const { error } = await supabase.auth.updateUser({ email })
        if (error) throw error
      }
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: fullName,
          phone,
          preferences,
          updated_at: new Date().toISOString(),
        })
      if (error) throw error
      setGeneralMessage({ type: 'success', text: 'Profiel succesvol bijgewerkt.' })
    } catch (error) {
      setGeneralMessage({ type: 'error', text: error.message })
    } finally {
      setUpdating(false)
    }
  }

  const handlePreferenceChange = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }))
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setGeneralMessage({ type: 'error', text: 'Vul een geldig e-mailadres in.' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) {
      setGeneralMessage({ type: 'error', text: error.message })
    } else {
      setGeneralMessage({ type: 'success', text: 'Wachtwoord-reset e-mail verzonden.' })
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleCopyScript = () => {
    navigator.clipboard.writeText(trackingScript)
    setCopySuccess('Script gekopieerd!')
    setTimeout(() => setCopySuccess(''), 2000)
  }

  if (loading || !user) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-gray-600">Laden...</p>
      </div>
    )
  }

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-6 px-4 py-10">
      <aside className="space-y-2">
        {[
  { key: 'account', label: 'Account' },
  { key: 'instellingen', label: 'Instellingen' },
  { key: 'facturen', label: 'Facturen' },
  { key: 'betaling', label: 'Betaalmethode' },
  {
    key: 'tracking',
    label: (
      <span className="flex items-center justify-between w-full">
        <span>Tracking script</span>
        {getTrackingStatusBadge()}
      </span>
    ),
  },
]

.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              window.location.hash = tab.key
              setGeneralMessage(null)
              setTrackingMessage(null)
            }}
            className={`block w-full text-left px-4 py-2 rounded ${
              activeTab === tab.key
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={handleLogout}
          className="block w-full text-left px-4 py-2 rounded hover:bg-red-100 text-red-600 mt-4"
        >
          Uitloggen
        </button>
      </aside>

      <main className="md:col-span-3 bg-white border rounded-xl p-6 shadow space-y-4">
        {activeTab !== 'tracking' && generalMessage && (
          <div
            className={`p-3 rounded ${
              generalMessage.type === 'success'
                ? 'bg-green-100 text-green-700'
                : generalMessage.type === 'info'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {generalMessage.text}
          </div>
        )}

        {activeTab === 'tracking' && trackingMessage && (
          <div
            className={`p-3 rounded ${
              trackingMessage.type === 'success'
                ? 'bg-green-100 text-green-700'
                : trackingMessage.type === 'info'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {trackingMessage.text}
          </div>
        )}

        {activeTab === 'account' && (
          <>
            <h2 className="text-xl font-semibold mb-4">Accountgegevens</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1">E-mailadres</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border px-3 py-2 rounded"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Volledige naam</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full border px-3 py-2 rounded"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Telefoonnummer</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border px-3 py-2 rounded"
                />
              </div>
              <fieldset>
                <legend className="text-sm font-medium mb-2">Voorkeuren</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={preferences.emailNotifications || false}
                    onChange={(e) =>
                      handlePreferenceChange('emailNotifications', e.target.checked)
                    }
                  />
                  E-mail notificaties ontvangen
                </label>
              </fieldset>
              <button
                onClick={handleUpdate}
                disabled={updating}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {updating ? 'Bezig...' : 'Profiel bijwerken'}
              </button>
              <button
                onClick={handlePasswordReset}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Wachtwoord reset e-mail sturen
              </button>
            </div>
          </>
        )}

        {activeTab === 'instellingen' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Instellingen</h2>
            <p className="text-gray-600">Hier kun je je voorkeuren instellen.</p>
          </div>
        )}

        {activeTab === 'facturen' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Facturen</h2>
            <p className="text-gray-600">Hier zie je je facturen.</p>
          </div>
        )}

        {activeTab === 'betaling' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Betaalmethode</h2>
            <p className="text-gray-600">Hier beheer je je betaalmethoden.</p>
          </div>
        )}

        {activeTab === 'tracking' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Tracking script</h2>
            
{lastTrackingPing ? (
  <div className="mb-2 text-sm flex items-start flex-col gap-1">
    {new Date() - new Date(lastTrackingPing) > 1000 * 60 * 60 * 24 ? (
      <>
        <div className="flex items-center gap-2 text-red-600 font-medium">
          ⚠️ Laatste tracking ping:{" "}
          <span>{new Date(lastTrackingPing).toLocaleString("nl-NL")}</span>
        </div>
        <p className="text-red-600">
          Je hebt al meer dan 24 uur geen trackingactiviteit ontvangen.
        </p>
      </>
    ) : (
      <div className="flex items-center gap-2 text-green-800 font-medium">
        ✅ Laatste tracking ping:{" "}
        <span>{new Date(lastTrackingPing).toLocaleString("nl-NL")}</span>
      </div>
    )}
  </div>
) : (
  <div className="mb-2 text-sm text-red-600 flex items-center gap-2">
    ❌ Nog geen tracking ping ontvangen.
  </div>
)}



            <p className="text-gray-600 mb-4">
              Plaats dit script in de &lt;head&gt; van je website om bezoekers te meten.
            </p>
            <div className="relative">
              <pre className="bg-gray-100 border rounded p-4 text-sm overflow-x-auto">
                {trackingScript}
              </pre>
              <button
                onClick={handleCopyScript}
                className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded hover:bg-blue-700"
              >
                Kopieer
              </button>
            </div>
            {copySuccess && (
              <p className="text-green-600 text-sm mt-2">{copySuccess}</p>
            )}
            <div className="mt-6">
              <button
                onClick={async () => {
                  setTrackingMessage(null)
                  setTrackingMessage({ type: 'info', text: 'Bezig met valideren...' })
                  await fetch(`/api/track`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: user.id,
    pageUrl: window.location.href,
    anonId: 'validation-test',
    durationSeconds: 1,
    utmSource: 'validation',
    utmMedium: 'internal',
    utmCampaign: 'script-validation',
    referrer: document.referrer || null,
    validationTest: true
  })
})

const res = await fetch(`/api/check-tracking?projectId=${user.id}`)
const json = await res.json()

                  if (json.status === 'ok') {
  setTrackingMessage({ type: 'success', text: 'Script gevonden en actief!' });
} else if (json.status === 'stale') {
  setTrackingMessage({
    type: 'error',
    text: 'Script gedetecteerd, maar geen recente activiteit. Probeer opnieuw te laden.'
  });
} else {
  setTrackingMessage({
    type: 'error',
    text: 'Script niet gevonden. Controleer of je het script hebt geplaatst.'
  });
}

// ✅ Nieuw: update de status direct in de UI
const refreshed = await supabase
  .from('profiles')
  .select('last_tracking_ping')
  .eq('id', user.id)
  .single();

if (refreshed?.data?.last_tracking_ping) {
  setLastTrackingPing(refreshed.data.last_tracking_ping);
}

                }}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                Valideer installatie
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}