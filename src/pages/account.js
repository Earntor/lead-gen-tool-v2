import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../lib/supabaseClient'
import { formatDutchDateTime } from '../lib/formatTimestamp'
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ⬇️ mini helper om secties conditioneel te tonen
const Section = ({ when, children }) => (when ? <>{children}</> : null)

// ⬅️ TeamTab alleen client-side (voorkomt SSR/hydration errors)
const TeamTab = dynamic(() => import('../components/TeamTab'), {
  ssr: false,
  loading: () => <p>Team laden…</p>,
})

function getTodayDomNL() {
  const now = new Date();
  const dayStr = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit' }).format(now);
  return parseInt(dayStr, 10);
}

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === 'string' ? label : undefined}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition
          ${checked ? 'translate-x-5' : 'translate-x-1'}`}
      />
    </button>
  );
}

const TAB_KEYS = ['account','instellingen','facturen','betaling','team','tracking'];
function normalizeTab(v) {
  const key = String(v || '').toLowerCase();
  return TAB_KEYS.includes(key) ? key : 'account';
}

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
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const [digest, setDigest] = useState({ daily: false, weekly: false, monthly: false, monthlyDom: null });
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestSaving, setDigestSaving] = useState(false);

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
        .select('full_name, phone, preferences, current_org_id')
        .eq('id', user.id)
        .single()

      if (profile) {
        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
        setPreferences(profile.preferences || {})
        setCurrentOrgId(profile.current_org_id || null)

        if (profile.current_org_id) {
          const { data: org } = await supabase
            .from('organizations')
            .select('last_tracking_ping')
            .eq('id', profile.current_org_id)
            .single()

          setLastTrackingPing(org?.last_tracking_ping || null)

          const domain = (process.env.NEXT_PUBLIC_TRACKING_DOMAIN || window.location.origin).replace(/\/$/, '')
          const script = `<script src="${domain}/tracker.js" data-project-id="${profile.current_org_id}" async></script>`
          setTrackingScript(script)
        }
      }

      if (!profile) {
        await supabase.from('profiles').upsert({ id: user.id });
      }

      setLoading(false)
    }
    fetchUser()
  }, [router])

  useEffect(() => {
    const onHashChange = () => {
      const newHash = window.location.hash.replace('#', '');
      const tab = normalizeTab(newHash || 'account');
      setActiveTab(tab);
      setGeneralMessage(null);
      setTrackingMessage(null);

      if (tab === 'tracking' && user?.id && currentOrgId) {
        supabase
          .from('organizations')
          .select('last_tracking_ping')
          .eq('id', currentOrgId)
          .single()
          .then(({ data }) => {
            if (data?.last_tracking_ping) setLastTrackingPing(data.last_tracking_ping);
          });
      }
    };

    const hash = window.location.hash.replace('#', '');
    if (hash) {
      setActiveTab(normalizeTab(hash));
      onHashChange();
    }

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [user, currentOrgId]);

  useEffect(() => {
    if (!user?.id || !currentOrgId) return;
    const channel = supabase
      .channel('profile-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${currentOrgId}` },
        (payload) => {
          if (payload.new?.last_tracking_ping) {
            setLastTrackingPing(payload.new.last_tracking_ping);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentOrgId])

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

  async function saveProfilePreference(key, value) {
    if (!user?.id) return;
    const next = { ...(preferences || {}), [key]: value };
    setPreferences(next);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          preferences: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (error) throw error;
      setGeneralMessage({ type: 'success', text: 'Instelling opgeslagen.' });
    } catch (e) {
      setGeneralMessage({
        type: 'error',
        text: 'Opslaan mislukt: ' + (e?.message || e),
      });
    }
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

  useEffect(() => {
    if (!user?.id || !currentOrgId) return;
    let cancelled = false;
    (async () => {
      setDigestLoading(true);
      try {
        const { data } = await supabase
          .from('digest_subscriptions')
          .select('daily_enabled, weekly_enabled, monthly_enabled, monthly_dom')
          .eq('user_id', user.id)
          .eq('org_id', currentOrgId)
          .maybeSingle();
        if (!cancelled && data) {
          setDigest({ daily: !!data.daily_enabled, weekly: !!data.weekly_enabled, monthly: !!data.monthly_enabled, monthlyDom: data.monthly_dom ?? null });
        } else if (!cancelled) {
          setDigest({ daily: false, weekly: false, monthly: false, monthlyDom: null });
        }
      } finally {
        if (!cancelled) setDigestLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, currentOrgId]);

  async function saveDigest(changes) {
    if (!user?.id || !currentOrgId) return;
    setDigestSaving(true);
    try {
      const next = { ...digest, ...changes };
      const { data, error } = await supabase.rpc('set_digest_subscription', {
        p_org_id: currentOrgId,
        p_daily:  !!next.daily,
        p_weekly: !!next.weekly,
        p_monthly:!!next.monthly,
        p_monthly_dom: next.monthly ? (next.monthlyDom ?? null) : null
      });
      if (error) throw error;
      setDigest({
        daily:     !!data.daily_enabled,
        weekly:    !!data.weekly_enabled,
        monthly:   !!data.monthly_enabled,
        monthlyDom: data.monthly_dom ?? null
      });
    } catch (e) {
      alert('Opslaan van e-mailoverzicht-instellingen mislukt: ' + (e?.message || e));
    } finally {
      setDigestSaving(false);
    }
  }

  // ⬇️ alle tab-inhoud in één interne component
  function Panels() {
    return (
      <>
        {/* ACCOUNT */}
        <Section when={activeTab === 'account'}>
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

          <h2 className="text-xl font-semibold mb-4">Accountgegevens</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1">E-mailadres</label>
              <Input
                type="email"
                autoComplete="email"
                aria-label="E-mailadres"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Volledige naam</label>
              <Input
                type="text"
                autoComplete="name"
                aria-label="Volledige naam"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Telefoonnummer</label>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-label="Telefoonnummer"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium mb-2">Voorkeuren</legend>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pref-email"
                  checked={!!preferences.emailNotifications}
                  onCheckedChange={(val) =>
                    setPreferences((p) => ({ ...p, emailNotifications: !!val }))
                  }
                />
                <Label htmlFor="pref-email" className="text-sm">
                  E-mail notificaties ontvangen
                </Label>
              </div>
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
        </Section>

        {/* INSTELLINGEN */}
        <Section when={activeTab === 'instellingen'}>
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

          <div>
            <h2 className="text-xl font-semibold mb-2">Instellingen</h2>
            <p className="text-gray-600 mb-4">
              E-mail overzichten met belangrijkste websitebezoekers.
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={digest.daily}
                  disabled={!currentOrgId || digestLoading || digestSaving}
                  onChange={(val) => saveDigest({ daily: val })}
                  label="Dagelijks om 07:00 (NL-tijd)"
                />
                <span>Ontvang dagelijks overzicht</span>
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={digest.weekly}
                  disabled={!currentOrgId || digestLoading || digestSaving}
                  onChange={(val) => saveDigest({ weekly: val })}
                  label="Wekelijks (maandag 07:00 NL)"
                />
                <span>Ontvang wekelijks overzicht</span>
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={digest.monthly}
                  disabled={!currentOrgId || digestLoading || digestSaving}
                  onChange={(val) => saveDigest({ monthly: val })}
                  label="Maandelijks 07:00 NL"
                />
                <span>Ontvang maandelijks overzicht</span>
              </div>

              {(digestLoading || digestSaving) && (
                <div className="text-sm text-gray-500">Opslaan…</div>
              )}
              {!digestLoading && !digestSaving && (
                <div className="text-sm text-green-700">
                  Wijzigingen worden automatisch opgeslagen.
                </div>
              )}

              <p className="text-xs text-gray-500 mt-2">
                We sturen alleen een mail als er bezoekers zijn binnen de periode (max 10). De mail toont exact dezelfde bedrijven als je dashboard.
              </p>

              <div className="mt-6 border-t pt-4">
                <h3 className="text-lg font-semibold mb-2">Realtime meldingen</h3>
                <div className="flex items-center gap-3">
                  <Toggle
                    checked={!!(preferences?.newLeadSoundOn ?? true)}
                    disabled={!user?.id}
                    onChange={(val) => saveProfilePreference('newLeadSoundOn', val)}
                    label="Geluid bij nieuwe bedrijven"
                  />
                  <span>Geluid bij nieuwe bedrijven</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Korte ping zodra er tijdens je sessie nieuwe bedrijven binnenkomen.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* FACTUREN */}
        <Section when={activeTab === 'facturen'}>
          <h2 className="text-xl font-semibold mb-4">Facturen</h2>
          <p className="text-gray-600">Hier zie je je facturen.</p>
        </Section>

        {/* BETALING */}
        <Section when={activeTab === 'betaling'}>
          <h2 className="text-xl font-semibold mb-4">Betaalmethode</h2>
          <p className="text-gray-600">Hier beheer je je betaalmethoden.</p>
        </Section>

        {/* TEAM */}
        <Section when={activeTab === 'team'}>
          <h2 className="text-xl font-semibold mb-4">Team</h2>
          <TeamTab />
        </Section>

        {/* TRACKING */}
        <Section when={activeTab === 'tracking'}>
          {trackingMessage && (
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

          <div>
            <h2 className="text-xl font-semibold mb-4">Tracking script</h2>

            {lastTrackingPing ? (
              <div className="mb-2 text-sm flex items-start flex-col gap-1">
                {new Date() - new Date(lastTrackingPing) > 1000 * 60 * 60 * 24 ? (
                  <>
                    <div className="flex items-center gap-2 text-red-600 font-medium">
                      ⚠️ Laatste tracking ping:{" "}
                      <span>{formatDutchDateTime(lastTrackingPing)}</span>
                    </div>
                    <p className="text-red-600">
                      Je hebt al meer dan 24 uur geen trackingactiviteit ontvangen.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-green-800 font-medium">
                    ✅ Laatste tracking ping:{" "}
                    <span>{formatDutchDateTime(lastTrackingPing)}</span>
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
                  if (!currentOrgId) {
                    setTrackingMessage({ type: 'error', text: 'Geen organisatie gekoppeld aan dit account.' });
                    return;
                  }
                  setTrackingMessage({ type: 'info', text: 'Bezig met valideren...' });
                  await fetch(`/api/track`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      projectId: currentOrgId,
                      pageUrl: window.location.href,
                      anonId: 'validation-test',
                      durationSeconds: 1,
                      utmSource: 'validation',
                      utmMedium: 'internal',
                      utmCampaign: 'script-validation',
                      referrer: document.referrer || null,
                      validationTest: true
                    })
                  });

                  const res = await fetch(`/api/check-tracking?projectId=${currentOrgId}`);
                  const json = await res.json();

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

                  const refreshed = await supabase
                    .from('organizations')
                    .select('last_tracking_ping')
                    .eq('id', currentOrgId)
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
        </Section>
      </>
    )
  }

  if (loading || !user) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-gray-600">Laden...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-10">
      <h1 className="text-xl md:text-2xl font-semibold mb-4">Mijn account</h1>

      {/* MOBIEL: tabbar + content */}
      <div className="md:hidden">
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            const next = normalizeTab(val);
            setActiveTab(next);
            window.location.hash = next;
            setGeneralMessage(null);
            setTrackingMessage(null);
          }}
        >
          <TabsList
            className={[
              "w-full bg-transparent p-0 border-b rounded-none",
              "sticky top-0 z-20 bg-white/90 backdrop-blur",
              "overflow-x-auto whitespace-nowrap justify-start px-1",
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            ].join(" ")}
          >
            <div className="flex gap-2 py-2">
              <TabsTrigger value="account"      className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">Account</TabsTrigger>
              <TabsTrigger value="instellingen" className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">Instellingen</TabsTrigger>
              <TabsTrigger value="facturen"     className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">Facturen</TabsTrigger>
              <TabsTrigger value="betaling"     className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">Betaalmethode</TabsTrigger>
              <TabsTrigger value="team"         className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">Team</TabsTrigger>
              <TabsTrigger value="tracking"     className="px-3 py-2 text-sm rounded-full data-[state=active]:bg-black data-[state=active]:text-white">
                <span className="flex items-center gap-2">
                  Tracking script
                  {getTrackingStatusBadge()}
                </span>
              </TabsTrigger>
            </div>
          </TabsList>
        </Tabs>

        {/* Actieve panel (alleen deze) */}
        <div className="mt-4 bg-white border rounded-xl p-6 shadow space-y-4">
          <Panels />
        </div>

        {/* Uitloggen alleen mobiel */}
        <div className="mt-6 md:hidden">
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded border hover:bg-gray-50 text-red-600"
          >
            Uitloggen
          </button>
        </div>
      </div>

      {/* DESKTOP: sidebar links, content rechts */}
      <div className="hidden md:grid grid-cols-4 gap-6">
        <aside className="space-y-2">
          {[
            { key: 'account', label: 'Account' },
            { key: 'instellingen', label: 'Instellingen' },
            { key: 'facturen', label: 'Facturen' },
            { key: 'betaling', label: 'Betaalmethode' },
            { key: 'team', label: 'Team' },
            {
              key: 'tracking',
              label: (
                <span className="flex items-center justify-between w-full">
                  <span>Tracking script</span>
                  {getTrackingStatusBadge()}
                </span>
              ),
            },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                const next = tab.key;
                setActiveTab(next);
                window.location.hash = next;
                setGeneralMessage(null);
                setTrackingMessage(null);
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

        <main className="col-span-3 bg-white border rounded-xl p-6 shadow space-y-4">
          <Panels />
        </main>
      </div>
    </div>
  )
}
