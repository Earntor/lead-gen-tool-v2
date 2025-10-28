import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../lib/supabaseClient'
import { formatDutchDateTime } from '../lib/formatTimestamp'
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const roleOptions = ['Sales', 'Marketing', 'Management', 'Technisch', 'Overig'] // zelfde set als API

// ⬇️ mini helper om secties conditioneel te tonen
const Section = ({ when, children }) => (when ? <>{children}</> : null)

const APP_URL =
  (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL) ||
  'https://app.leadetect.com';

const EMAIL_REDIRECT_TO = `${APP_URL}/auth/callback`; // <- pagina waar je Supabase email links op landen


// ⬅️ TeamTab alleen client-side (voorkomt SSR/hydration errors)
const TeamTab = dynamic(() => import('../components/TeamTab'), {
  ssr: false,
  loading: () => <p>Team laden…</p>,
})

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

/* ===========================
   NIEUW: Panels los component
   (buiten Account)
=========================== */
function AccountPanels({ ctx }) {
  const {
    activeTab,
    generalMessage, setGeneralMessage,
    trackingMessage, setTrackingMessage,
    email, setEmail,
    firstName, setFirstName,
    lastName, setLastName,
    phone, setPhone,
    preferences, setPreferences,
    roleOptions,
    handlePreferenceChange,
    formatDutchDateTime,
    lastTrackingPing, setLastTrackingPing,
    trackingScript,
    handleCopyScript,
    copySuccess,
    saveProfilePreference,
    // bedrijf & domein
    isOrgOwner,
    companyName, setCompanyName,
    companyDomain, setCompanyDomain,
    websiteUrl,
    savingCompany,
    saveAccountTab,
    // digest
    digest, digestLoading, digestSaving, saveDigest,
    // nodig in tracking/team
    user, currentOrgId, pollRef, checkTracking, handlePasswordReset,
  } = ctx;

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

  {/* Input + knop als 1 aaneengesloten groep */}
  <div className="flex items-stretch">
    <Input
      type="email"
      value={email}
      readOnly
      aria-label="Login e-mailadres"
      className="bg-gray-50 rounded-l-lg rounded-r-none border-r-0"
    />
    <button
      type="button"
      onClick={() => {
        ctx.setNewEmail1('');
        ctx.setNewEmail2('');
        ctx.setShowEmailModal(true);
      }}
      className="inline-flex items-center px-3 py-2 text-sm border rounded-r-lg border-l-0 bg-gray-100 hover:bg-gray-200 whitespace-nowrap"
      aria-label="Wijzig e-mail"
    >
      Wijzig e-mail
    </button>
  </div>

  {ctx.pendingEmail ? (
    <div className="mt-2 text-sm rounded bg-yellow-50 text-yellow-800 p-2">
      Bevestig je nieuwe e-mail <b>{ctx.pendingEmail}</b> via de link die we zojuist stuurden.
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={ctx.cancelPendingEmailChange}
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
        >
          Annuleren
        </button>
        <button
          type="button"
          onClick={ctx.resendEmailChange}
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
        >
          Link opnieuw sturen
        </button>
      </div>
    </div>
  ) : null}
</div>



          {/* Voornaam + Achternaam naast elkaar op desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Voornaam</label>
              <Input
                type="text"
                autoComplete="given-name"
                aria-label="Voornaam"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Achternaam</label>
              <Input
                type="text"
                autoComplete="family-name"
                aria-label="Achternaam"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
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

          <div>
            <label className="block text-sm mb-1">Functietitel / Rol</label>
            <select
              aria-label="Functietitel / Rol"
              className="w-full border rounded px-3 py-2 text-sm"
              value={preferences?.user_role || ''}
              onChange={(e) => handlePreferenceChange('user_role', e.target.value)}
            >
              <option value="">Kies je rol…</option>
              {roleOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Wordt gebruikt voor tips en rapporten in je dashboard.
            </p>
          </div>

          {/* --- Bedrijf & Domein --- */}
          <div className="mt-8 border-t pt-6">
            <h3 className="text-lg font-semibold mb-3">Bedrijf &amp; website</h3>
            {!isOrgOwner && (
              <p className="text-sm text-gray-600 mb-3">
                Alleen de <b>eigenaar</b> kan deze gegevens wijzigen. Je kunt ze wel bekijken.
              </p>
            )}

            <div className="space-y-4">
              {/* Bedrijfsnaam */}
              <div>
                <label className="block text-sm mb-1">Bedrijfsnaam</label>
                <Input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={!isOrgOwner}
                  placeholder="Bijv. Interfloor BV"
                />
              </div>

              {/* Domein met grijze prefix "https://" */}
              <div>
                <label className="block text-sm mb-1">Website (zonder https://)</label>
                <div className="flex items-stretch">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 bg-gray-100 text-gray-600 text-sm select-none">
                    https://
                  </span>
                  <input
                    type="text"
                    inputMode="url"
                    pattern="^[^\\s/]+$"
                    value={companyDomain}
                    onChange={(e) => {
                      let v = e.target.value.trim();
                      v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
                      setCompanyDomain(v);
                    }}
                    disabled={!isOrgOwner}
                    placeholder="bedrijf.nl"
                    className="w-full rounded-r-lg border px-3 py-2 text-sm"
                    aria-describedby="acc-domain-help"
                  />
                </div>
                <p id="acc-domain-help" className="text-xs text-gray-500 mt-1">
                  Alleen het hoofddomein invullen. Voorbeeld: <code>bedrijf.nl</code>
                </p>
              </div>

              {/* Website URL (alleen tonen als bekend) */}
              {websiteUrl && (
                <p className="text-xs text-gray-500">
                  Website URL: <span className="font-mono">{websiteUrl}</span>
                </p>
              )}

              {/* Opslaan */}
              <div>
                <button
                  onClick={saveAccountTab}
                  disabled={savingCompany}
                  className="bg-black text-white px-4 py-2 rounded hover:bg-neutral-800 disabled:opacity-50"
                >
                  {savingCompany ? 'Opslaan…' : 'Opslaan'}
                </button>

                {!isOrgOwner && (
                  <span className="ml-3 text-xs text-gray-500">
                    Je bent geen eigenaar van deze organisatie.
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (!email) {
                setGeneralMessage?.({ type: 'error', text: 'Vul een geldig e-mailadres in.' });
                return;
              }
              handlePasswordReset?.();
            }}
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
                disabled={digestLoading || digestSaving}
                onChange={(val) => saveDigest({ daily: val })}
                label="Dagelijks om 07:00 (NL-tijd)"
              />
              <span>Ontvang dagelijks overzicht</span>
            </div>

            <div className="flex items-center gap-3">
              <Toggle
                checked={digest.weekly}
                disabled={digestLoading || digestSaving}
                onChange={(val) => saveDigest({ weekly: val })}
                label="Wekelijks (maandag 07:00 NL)"
              />
              <span>Ontvang wekelijks overzicht</span>
            </div>

            <div className="flex items-center gap-3">
              <Toggle
                checked={digest.monthly}
                disabled={digestLoading || digestSaving}
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

          <div className="mb-2 text-sm flex items-start flex-col gap-1">
            {lastTrackingPing ? (
              <>
                <div className="flex items-center gap-2 text-green-800 font-medium">
                  ✅ Script gevonden en actief
                </div>
                <p className="text-xs text-gray-600">
                  Laatste ping: {formatDutchDateTime(lastTrackingPing)}
                </p>
              </>
            ) : (
              <div className="text-red-600 font-medium">
                ❌ Script niet gevonden
              </div>
            )}
          </div>

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

          {/* Valideer installatie knop */}
          <div className="mt-6">
            <button
              onClick={async () => {
                if (!currentOrgId) {
                  setTrackingMessage({ type: 'error', text: 'Geen organisatie gekoppeld aan dit account.' });
                  return;
                }

                setTrackingMessage({
                  type: 'info',
                  text: 'Open je website in een nieuw tabblad en vernieuw de pagina. We controleren elke 5 seconden of het script een ping stuurt.'
                });

                const POLL_MS = 5000;
                const TIMEOUT_MS = 2 * 60 * 1000; // 2 minuten
                const deadline = Date.now() + TIMEOUT_MS;

                // Veiligheidsnet: stop een eventuele eerdere poll
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

                const check = async () => {
                  const j = await checkTracking(currentOrgId);
                  return j?.status === 'active' ? (j.last_ping_at || null) : null;
                };

                // Eerste check
                let last = await check();
                if (last) {
                  setLastTrackingPing(last);
                  setTrackingMessage({ type: 'success', text: 'Script gevonden en actief!' });
                  return;
                }

                // Poll tot actief of timeout
                pollRef.current = setInterval(async () => {
                  if (Date.now() > deadline) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setTrackingMessage({
                      type: 'error',
                      text: 'Script niet gevonden. Controleer of je het script hebt geplaatst en laad je site opnieuw.'
                    });
                    return;
                  }
                  last = await check();
                  if (last) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setLastTrackingPing(last);
                    setTrackingMessage({ type: 'success', text: 'Script gevonden en actief!' });
                  }
                }, POLL_MS);
              }}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Valideer installatie
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

/* ===========================
   HOOFD-COMPONENT
=========================== */
export default function Account() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('account')

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [preferences, setPreferences] = useState({})
  const [generalMessage, setGeneralMessage] = useState(null)
  const [trackingMessage, setTrackingMessage] = useState(null)
  const [copySuccess, setCopySuccess] = useState('')
  const [trackingScript, setTrackingScript] = useState('')
  const [lastTrackingPing, setLastTrackingPing] = useState(null);
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const [digest, setDigest] = useState({ daily: false, weekly: false, monthly: false, monthlyDom: null });
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestSaving, setDigestSaving] = useState(false);
  const pollRef = useRef(null);
  // ← bedrijf + domein
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isOrgOwner, setIsOrgOwner] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const getTrackingStatusBadge = () => {
    const isActive = !!lastTrackingPing;
    return isActive ? (
      <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium">
        Actief
      </span>
    ) : (
      <span className="bg-gray-200 text-gray-800 px-2 py-0.5 rounded text-xs font-medium">
        Geen recente activiteit
      </span>
    );
  };

  // ✅ Helper: altijd met Bearer token checken
  const checkTracking = async (orgId) => {
    const { data } = await supabase.auth.getSession();
    const t = data?.session?.access_token || null;
    const r = await fetch(`/api/check-tracking?orgId=${encodeURIComponent(orgId)}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {}
    });
    return r.json();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsDesktop(window.innerWidth >= 768);
  }, []);

    // ---- E-MAIL WIJZIGEN FLOW ----
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [newEmail1, setNewEmail1] = useState('');
  const [newEmail2, setNewEmail2] = useState('');
  const [emailChanging, setEmailChanging] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(false);


  function isValidEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim()); }

async function updatePendingEmailWithRetry(val, tries = 3, delay = 300) {
  for (let i = 0; i < tries; i++) {
    const { error } = await supabase
      .from('profiles')
      .update(
        { pending_email: val, updated_at: new Date().toISOString() },
        { returning: 'minimal' }
      )
      .eq('id', user.id);

    if (!error) return true;
    // wachttijd 300ms, 600ms, 1200ms
    await new Promise(r => setTimeout(r, delay * (2 ** i)));
  }
  return false;
}

  
async function requestEmailChange() {
  const a = (newEmail1 || '').trim().toLowerCase();
  const b = (newEmail2 || '').trim().toLowerCase();

  // Validatie – toon fouten IN de modal
  if (!isValidEmail(a)) { setEmailError('Voer een geldig e-mailadres in.'); return; }
  if (a !== b)          { setEmailError('Beide e-mailadressen moeten overeenkomen.'); return; }
  if (a === (email || '').toLowerCase()) { setEmailError('Dit is al je huidige e-mail.'); return; }

  // Cooldown (4s)
  if (emailCooldown) return;
  setEmailCooldown(true);
  setTimeout(() => setEmailCooldown(false), 4000);

  // Reset fout en zet spinner AAN (modal blijft open!)
  setEmailError('');       // wis oude fout
setEmailChanging(true);  // spinner aan
try {
    // 1) Auth-call (leidend). Stuurt de bevestigingsmail.
    const { error: authErr } = await supabase.auth.updateUser(
      { email: a },
      { emailRedirectTo: EMAIL_REDIRECT_TO }
    );
    if (authErr) throw authErr;

    // 2) DB-notitie best-effort + retry (non-blocking, maar we wachten wél kort)
    //    (we wachten even mee zodat pendingEmail in UI direct klopt)
    const ok = await updatePendingEmailWithRetry(a, 3, 300);
    if (!ok) console.warn('[email-change] DB update niet gelukt na retries (non-blocking).');

    // 3) UI bijwerken: pas nu modal sluiten + banners tonen
    setPendingEmail(a);
    setShowEmailModal(false);
    setGeneralMessage({ type: 'success', text: `We hebben een bevestigingslink gestuurd naar ${a}.` });
  } catch (e) {
    // Fout IN de modal tonen
    setEmailError(e?.message || String(e));
  } finally {
    setEmailChanging(false);
  }
}

  async function cancelPendingEmailChange() {
  const prev = pendingEmail;
  // Optimistisch: direct uit UI
  setPendingEmail('');
  setGeneralMessage({ type:'success', text:'E-mailwijziging geannuleerd.' });

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ pending_email: null, updated_at: new Date().toISOString() }, { returning: 'minimal' })
      .eq('id', user.id);
    if (error) throw error;
  } catch (e) {
    // Rollback bij fout
    setPendingEmail(prev);
    setGeneralMessage({ type:'error', text:'Annuleren mislukt: ' + (e?.message || e) });
  }
}


  async function resendEmailChange() {
  const a = (pendingEmail || '').trim().toLowerCase();

  // Validatie eerst → directe feedback
  if (!isValidEmail(a)) {
    setGeneralMessage({ type: 'error', text: 'Geen geldig e-mailadres in behandeling.' });
    return;
  }

  // Cooldown (4s)
  if (emailCooldown) return;
  setEmailCooldown(true);
  setTimeout(() => setEmailCooldown(false), 4000);

  try {
    const { error } = await supabase.auth.updateUser(
      { email: a },
      { emailRedirectTo: EMAIL_REDIRECT_TO }
    );
    if (error) throw error;

    setGeneralMessage({ type: 'success', text: `Bevestigingsmail opnieuw verstuurd naar ${a}.` });
  } catch (e) {
    setGeneralMessage({ type: 'error', text: 'Opnieuw sturen mislukt: ' + (e?.message || e) });
  }
}





  useEffect(() => {
  if (!router.isReady) return;         // ⬅️ wacht tot Next router klaar is
  let isMounted = true;

  const fetchUser = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      // Geen sessie of fout ⇒ naar login
      if (error || !session?.user) {
        setLoading(false);             // ⬅️ belangrijk: loading altijd clearen
        router.replace('/login');
        return;
      }

      const authUser = session.user;
      setUser(authUser);
      setEmail(authUser.email);

      // Profiel-email in sync houden (upsert)
      try {
        await supabase
          .from('profiles')
          .upsert({
            id: authUser.id,
            email: authUser.email ?? null,
            updated_at: new Date().toISOString(),
          });
      } catch {}

      // Profiel ophalen
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, full_name, phone, preferences, current_org_id, pending_email')
        .eq('id', authUser.id)
        .single();

      if (!isMounted) return;

      if (profile) {
        setFirstName(profile.first_name || '');
        setLastName(profile.last_name || '');
        if ((!profile.first_name || !profile.last_name) && (profile.full_name || '').trim()) {
          const parts = profile.full_name.trim().split(/\s+/);
          const ln = parts.pop() || '';
          const fn = parts.join(' ');
          if (!profile.first_name) setFirstName(fn);
          if (!profile.last_name) setLastName(ln);
        }
        setPhone(profile.phone || '');
        setPreferences(profile.preferences || {});
        setCurrentOrgId(profile.current_org_id || null);
// Alleen serverwaarde overnemen als we lokaal nog niets hebben gezet
if (!pendingEmail) {
  setPendingEmail(profile.pending_email || '');
}

        if (profile.current_org_id) {
          try {
            const j = await checkTracking(profile.current_org_id);
            if (isMounted) {
              setLastTrackingPing(j?.status === 'active' ? (j.last_ping_at || null) : null);
            }
          } catch {}

          const domain = (process.env.NEXT_PUBLIC_TRACKING_DOMAIN || window.location.origin).replace(/\/$/, '');
          const script = `<script src="${domain}/tracker.js" data-project-id="${profile.current_org_id}" async></script>`;
          setTrackingScript(script);

          const { data: org } = await supabase
            .from('organizations')
            .select('id, name, company_domain, website_url, owner_user_id')
            .eq('id', profile.current_org_id)
            .maybeSingle();

          if (isMounted && org) {
            setCompanyName(org.name || '');
            setCompanyDomain(org.company_domain || '');
            setWebsiteUrl(org.website_url || '');
            setIsOrgOwner(org.owner_user_id === authUser.id);
          }
        }

        // pending_email opruimen als Auth.email == pending_email
        try {
          const authEmail = (authUser.email || '').toLowerCase();
          if (profile?.pending_email && profile.pending_email.toLowerCase() === authEmail) {
            await supabase
              .from('profiles')
              .update({ pending_email: null, updated_at: new Date().toISOString() })
              .eq('id', authUser.id);
            if (isMounted) setPendingEmail('');
          }
        } catch {}
      }
    } finally {
      if (isMounted) setLoading(false);  // ⬅️ ALTIJD loading uit, ook bij fouten
    }
  };

  fetchUser();

  return () => { isMounted = false; };
}, [router.isReady]); // ⬅️ let op: dependency is router.isReady, NIET router


  useEffect(() => {
    const onHashChange = () => {
      const newHash = window.location.hash.replace('#', '');
      const tab = normalizeTab(newHash || 'account');
      setActiveTab(tab);
      setGeneralMessage(null);
      setTrackingMessage(null);

      if (tab === 'tracking' && user?.id && currentOrgId) {
        checkTracking(currentOrgId)
          .then(j => {
            if (j?.status === 'active') setLastTrackingPing(j.last_ping_at || null);
            else setLastTrackingPing(null);
          })
          .catch(() => {});
      }
    };

    let hash = window.location.hash.replace('#', '');
if (!hash) {
  // altijd een geldige tab forceren
  const def = 'account';
  window.location.hash = def;
  hash = def;
}
onHashChange();


    window.addEventListener('hashchange', onHashChange);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [user, currentOrgId]);

 useEffect(() => {
  const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      // Altijd UI-syncen met Auth
      setUser(session.user);
      setEmail(session.user.email);

      // 1) profiles.email upserten (blijft je digest-trigger)
      try {
        await supabase
          .from('profiles')
          .upsert({
            id: session.user.id,
            email: session.user.email ?? null,
            updated_at: new Date().toISOString(),
          });
      } catch {}

      // 2) Als de user net is geüpdatet (na email-verify), pending_email opruimen
      if (event === 'USER_UPDATED') {
        try {
          await supabase
            .from('profiles')
            .update({
              pending_email: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.user.id);
        } catch {}
        // UI meteen opschonen
        setPendingEmail('');
        setGeneralMessage({
          type: 'success',
          text: 'Je e-mailadres is bevestigd en bijgewerkt.'
        });
      }
    } else {
      setUser(null);
    }
  });

  return () => {
    subscription?.subscription?.unsubscribe?.();
  };
}, []);



  // 🔔 Realtime updates
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('profile-self')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload) => {
          const p = payload.new || {}
          if (typeof p.first_name !== 'undefined') setFirstName(p.first_name || '')
          if (typeof p.last_name  !== 'undefined') setLastName(p.last_name || '')
          if (typeof p.phone      !== 'undefined') setPhone(p.phone || '')
          if (typeof p.preferences!== 'undefined') setPreferences(p.preferences || {})
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id])

  useEffect(() => {
    if (!user?.id || !currentOrgId) return;
    const channel = supabase
      .channel('profile-org-tracking')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${currentOrgId}` },
        (payload) => {
          const o = payload.new || {};
          if (typeof o.last_tracking_ping !== 'undefined') {
            setLastTrackingPing(o.last_tracking_ping || null);
          }
          if (typeof o.name !== 'undefined') {
            setCompanyName(o.name || '');
          }
          if (typeof o.company_domain !== 'undefined') {
            setCompanyDomain(o.company_domain || '');
          }
          if (typeof o.website_url !== 'undefined') {
            setWebsiteUrl(o.website_url || '');
          }
          if (typeof o.owner_user_id !== 'undefined' && user?.id) {
            setIsOrgOwner(o.owner_user_id === user.id);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentOrgId])

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
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: EMAIL_REDIRECT_TO,
});
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

  async function getBearer() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function saveAccountTab() {
    if (!user?.id) {
      setGeneralMessage({ type: 'error', text: 'Gebruiker niet geladen. Probeer het zo opnieuw.' });
      return;
    }
    setGeneralMessage(null);

    const nm = String(companyName || '').trim();
    let dm = String(companyDomain || '').trim();
    dm = dm.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

    const willUpdateOrg = isOrgOwner && nm && dm;
    setSavingCompany(true);

    try {
      const ops = [];

      ops.push(
        (async () => {
          const full_name = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
          const { error } = await supabase
            .from('profiles')
            .upsert({
              id: user.id,
              first_name: firstName || null,
              last_name:  lastName  || null,
              full_name:  full_name || null,
              phone: (phone || '').trim() || null,
              preferences,
              updated_at: new Date().toISOString(),
            });
          if (error) throw new Error('Profiel bijwerken: ' + error.message);
        })()
      );

      if (willUpdateOrg) {
        ops.push(
          (async () => {
            const t = await getBearer();
            const resp = await fetch('/api/onboarding', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
              body: JSON.stringify({ action: 'saveCompany', companyName: nm, domain: dm }),
            });
            const json = await resp.json().catch(() => null);
            if (!resp.ok) throw new Error('Organisatie opslaan: ' + (json?.error || 'onbekende fout'));

            setCompanyDomain(json?.company_domain || dm);
            setWebsiteUrl(json?.website_url || (`https://${dm}/`));
          })()
        );
      }

      await Promise.all(ops);

      if (!willUpdateOrg && !isOrgOwner) {
        setGeneralMessage({
          type: 'success',
          text: 'Profiel opgeslagen. (Organisatie niet bijgewerkt: je bent geen eigenaar.)'
        });
      } else if (willUpdateOrg) {
        setGeneralMessage({ type: 'success', text: 'Profiel en organisatie opgeslagen.' });
      } else {
        setGeneralMessage({ type: 'success', text: 'Profiel opgeslagen.' });
      }
    } catch (e) {
      setGeneralMessage({
        type: 'error',
        text: (e?.message || String(e)).replace(/^Error:\s*/i, '')
      });
    } finally {
      setSavingCompany(false);
    }
  }

  const panelsCtx = {
    activeTab,
    generalMessage, setGeneralMessage,
    trackingMessage, setTrackingMessage,
    email, setEmail,
    firstName, setFirstName,
    lastName, setLastName,
    phone, setPhone,
    preferences, setPreferences,
    roleOptions,
    handlePreferenceChange,
    formatDutchDateTime,
    lastTrackingPing, setLastTrackingPing,
    trackingScript,
    handleCopyScript,
    copySuccess,
    saveProfilePreference,
    // bedrijf & domein
    isOrgOwner,
    companyName, setCompanyName,
    companyDomain, setCompanyDomain,
    websiteUrl,
    savingCompany,
    saveAccountTab,
    // digest
    digest, digestLoading, digestSaving, saveDigest,
    // nodig voor knoppen/TeamTab in child
    user, currentOrgId, pollRef, checkTracking, handlePasswordReset,
    // e-mail wijziging helpers/state
   pendingEmail,
   setShowEmailModal,
   setNewEmail1,
   setNewEmail2,
   cancelPendingEmailChange,
   resendEmailChange,
  };

  if (loading) {
  return (
    <div className="flex justify-center items-center h-screen">
      <p className="text-gray-600">Laden...</p>
    </div>
  );
}


  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-10">
      <h1 className="text-xl md:text-2xl font-semibold mb-4">Mijn account</h1>
      {!isDesktop ? (
        // --- MOBIEL ---
        <div>
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
                "sticky top-0 z-[5] bg-white/90 supports-[backdrop-filter]:backdrop-blur supports-[backdrop-filter]:bg-white/70",
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

          <div className="mt-4 bg-white border rounded-xl p-6 shadow space-y-4">
            <AccountPanels ctx={panelsCtx} />
          </div>

          {/* Uitloggen alleen mobiel */}
          <div className="mt-6">
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded border hover:bg-gray-50 text-red-600"
            >
              Uitloggen
            </button>
          </div>
        </div>
      ) : (
        // --- DESKTOP ---
        <div className="grid grid-cols-4 gap-6">
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
            <AccountPanels ctx={panelsCtx} />
          </main>
        </div>
      )}
      {showEmailModal && (
  <div
    className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
    onKeyDown={(e) => { if (e.key === 'Escape') setShowEmailModal(false); }}
    tabIndex={-1}
  >
    <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">
      <h3 className="text-lg font-semibold mb-2">Nieuw e-mailadres</h3>
      <p className="text-sm text-gray-600 mb-4">
        We sturen een bevestigingslink naar je nieuwe e-mail. Tot die tijd blijft je huidige login werken.
      </p>

      <label className="block text-sm mb-1">Nieuw e-mailadres</label>
<Input
  type="email"
  value={newEmail1}
  onChange={(e) => {
    setNewEmail1(e.target.value);
    setEmailError(''); // ⬅️ foutmelding wissen tijdens typen
  }}
  placeholder="naam@bedrijf.nl"
  className="mb-3"
/>

      <label className="block text-sm mb-1">Herhaal e-mailadres</label>
<Input
  type="email"
  value={newEmail2}
  onChange={(e) => {
    setNewEmail2(e.target.value);
    setEmailError(''); // ⬅️ foutmelding wissen tijdens typen
  }}
  placeholder="naam@bedrijf.nl"
/>

{/* ⬇️ Toon inline foutmelding in de modal */}
{emailError && (
  <p className="mt-2 text-sm text-red-600">{emailError}</p>
)}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
  className="px-3 py-2 rounded border hover:bg-gray-50"
  onClick={() => setShowEmailModal(false)}
>
  Annuleren
</button>
        <button
  type="button"
  className="px-3 py-2 rounded bg-black text-white hover:bg-neutral-800 disabled:opacity-50"
  onClick={requestEmailChange}
disabled={emailChanging || emailCooldown || !newEmail1 || !newEmail2}
>
  {emailChanging ? 'Versturen…' : 'Bevestigingsmail sturen'}
</button>

      </div>
    </div>
  </div>
)}

    </div>
  )
}
