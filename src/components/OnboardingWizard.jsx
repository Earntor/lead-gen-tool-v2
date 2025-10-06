// components/OnboardingWizard.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

const roleOptions = ['Sales', 'Marketing', 'Management', 'Technisch', 'Overig'];

export default function OnboardingWizard({ open, onClose, onComplete }) {
  const [visible, setVisible] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [orgId, setOrgId] = useState(null);
  const [token, setToken] = useState(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');

  const [step, setStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(3);

  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const [pollStatus, setPollStatus] = useState('idle');

  // 👇 nieuw voor stap 3 (script tonen + kopiëren + valideren)
  const [trackingScript, setTrackingScript] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [validateMsg, setValidateMsg] = useState(null);
  const [validating, setValidating] = useState(false);

  // ---------- helpers ----------
  function splitFullName(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return ['', ''];
    if (parts.length === 1) return [parts[0], ''];
    return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
  }

  async function getFreshTokenWithRetry(maxWaitMs = 5000) {
    const started = Date.now();
    let t = null;

    const { data } = await supabase.auth.getSession();
    t = data?.session?.access_token || null;

    while (!t && (Date.now() - started) < maxWaitMs) {
      await supabase.auth.refreshSession().catch(() => {});
      const { data } = await supabase.auth.getSession();
      t = data?.session?.access_token || null;
      if (t) break;
      await new Promise(r => setTimeout(r, 150));
    }

    if (!t) {
      alert('Niet ingelogd (geen token). Ververs de pagina en probeer opnieuw.');
      throw new Error('missing token');
    }
    setToken(t);
    return t;
  }

  async function authedFetch(url, options = {}) {
    const t = await getFreshTokenWithRetry();
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${t}` };
    return fetch(url, { ...options, headers });
  }

  async function parseJsonSafe(resp) {
    try { return await resp.json(); } catch { return null; }
  }
  // ---------- einde helpers ----------

  useEffect(() => {
    if (open === true) setVisible(true);
if (open === false) {
   setVisible(false);
   stopPolling(); // ⬅️ hier ook opruimen
 }  
}, [open]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data?.session?.access_token;
      setToken(t || null);
      if (!t) return;

      const resp = await fetch('/api/onboarding?action=state', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (cancelled) return;
      if (!json?.ok) return;

      setIsOwner(!!json.isOwner);
      setOrgId(json.orgId || null);

      const prefs = json.preferences || {};
      const onboarding = prefs.onboarding || {};

      const [fn, ln] = splitFullName(json?.profile?.full_name || '');
      setFirstName(fn);
      setLastName(ln);
      setPhone(json?.profile?.phone || '');
      setRole(prefs.user_role || '');

      const owner = !!json.isOwner;
      setTotalSteps(owner ? 4 : 3);

      let s = 1;
      if (onboarding.step === 'profile_done') s = 2;
      if (onboarding.step === 'role_done') s = owner ? 3 : 3;
      if (onboarding.completed) {
        setVisible(false);
        return;
      }
      setStep(s);
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // 👉 bouw het tracking script zodra we een orgId hebben
  useEffect(() => {
    if (!orgId) { setTrackingScript(''); return; }
    // zelfde logica als in account.js
    const domain =
      (process.env.NEXT_PUBLIC_TRACKING_DOMAIN || (typeof window !== 'undefined' ? window.location.origin : ''))
        .replace(/\/$/, '');
    const script = `<script src="${domain}/tracker.js" data-project-id="${orgId}" async></script>`;
    setTrackingScript(script);
  }, [orgId]);

  // (diagnose) klik-capture zolang modal open is
  useEffect(() => {
    if (!visible) return;
    const capture = (e) => {
      const path = e.composedPath ? e.composedPath() : (e.path || []);
      const top = path && path[0];
      const fmt = (el) =>
        el && el.nodeType === 1
          ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).replace(/\s+/g, '.') : ''}`
          : String(el);
      console.log('[Onboarding] CAPTURE CLICK →', fmt(top));
    };
    document.addEventListener('click', capture, true);
    return () => document.removeEventListener('click', capture, true);
  }, [visible]);

  const progress = useMemo(() => Math.round((step / totalSteps) * 100), [step, totalSteps]);
  if (!visible) return null;

  // -------- actions via authedFetch --------
  async function saveProfile() {
    console.log('[Onboarding] saveProfile() start');
    if (!firstName.trim()) return alert('Vul je voornaam in');
    if (!lastName.trim())  return alert('Vul je achternaam in');
    setLoading(true);
    try {
      const resp = await authedFetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveProfile', firstName, lastName, phone }),
      });
      if (!resp.ok) throw new Error((await parseJsonSafe(resp))?.error || 'Opslaan mislukt');
      setStep((s) => s + 1);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveRole() {
    console.log('[Onboarding] saveRole() start');
    if (!role) return alert('Kies je rol');
    setLoading(true);
    try {
      const resp = await authedFetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveRole', role }),
      });
      if (!resp.ok) throw new Error((await parseJsonSafe(resp))?.error || 'Opslaan mislukt');
      setStep((s) => s + 1);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function complete() {
    console.log('[Onboarding] complete() start');
    setLoading(true);
    try {
      const resp = await authedFetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (!resp.ok) throw new Error((await parseJsonSafe(resp))?.error || 'Afronden mislukt');
      setVisible(false);
      onComplete && onComplete();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // --------- Polling (on change detect) ----------
  function startPolling() {
  console.log('[Onboarding] startPolling()');
  if (!orgId) return alert('Org ontbreekt, ververs de pagina en probeer opnieuw.');
  if (pollRef.current) return; // al bezig

  setPolling(true);
  setPollStatus('checking');

  const deadline = Date.now() + 2 * 60 * 1000; // ⬅️ stopt na 2 minuten automatisch (optie)

  const tick = async () => {
    try {
      const resp = await authedFetch(`/api/check-tracking?orgId=${encodeURIComponent(orgId)}`);
      if (!pollRef.current) return;
      const json = await parseJsonSafe(resp);
      if (!pollRef.current) return;

      if (json?.status === 'active') {
        setPollStatus('ok');
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPolling(false);
      } else {
        setPollStatus('not_found');
      }

      // timeout na 2 minuten
      if (Date.now() > deadline && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPolling(false);
        // laat status staan op 'not_found' of 'checking'
      }
    } catch {
      if (!pollRef.current) return;
      setPollStatus('error');
      // bij error ook stoppen na timeout
      if (Date.now() > deadline && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPolling(false);
      }
    }
  };

  tick(); // eerste check meteen
  pollRef.current = setInterval(tick, 5000);
}

  function stopPolling() {
    console.log('[Onboarding] stopPolling()');
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
    setPollStatus('idle');
  }

  // --------- Validate like account.js (one-shot) ----------
async function validateOnce() {
  if (!orgId) return alert('Geen organisatie gekoppeld.');
  setValidating(true);
  setValidateMsg({
    type: 'info',
    text: 'Open je website in een nieuw tabblad en vernieuw de pagina. We controleren elke 5 seconden of het script een ping stuurt (venster 7 dagen).'
  });

  // 1) Eén directe check
  try {
    const res = await authedFetch(`/api/check-tracking?orgId=${encodeURIComponent(orgId)}`);
    const json = await res.json();
    if (json?.status === 'active') {
      setValidateMsg({ type: 'success', text: '✅ Script gevonden en actief!' });
      setPollStatus('ok');
      setValidating(false);
      return;
    }
  } catch {
    // negeren; we gaan pollen
  }

  // 2) Start automatische check (hergebruikt bestaande flow)
  setValidating(false);
  startPolling();
}


  // -------- unified activators (mousedown + keyboard) --------
  const activate = (handler) => (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (loading) return;
    handler && handler();
  };
  const keyActivate = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      activate(handler)(e);
    }
  };

  // Knoppen: Later afronden links, Volgende rechts
  const ActionBar = ({ onPrimary, primaryText, onSecondary, secondaryText, disabled }) => (
    <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
      {/* Later afronden */}
      <button
        type="button"
        onMouseDown={activate(() => {
          console.log('[Onboarding] SNOOZE mousedown → run');
          stopPolling();
          setVisible(false);
          onClose && onClose();
          // server call fire-and-forget
          (async () => {
            try {
              const resp = await authedFetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'snooze', minutes: 60 * 24 }),
              });
              if (!resp.ok) console.warn('Snooze serverfout');
            } catch (e) {
              console.warn('Snooze faalde:', e);
            }
          })();
        })}
        onKeyDown={keyActivate(() => {
          setVisible(false);
          onClose && onClose();
        })}
        onClick={(e) => e.stopPropagation()}
        className="text-sm text-gray-500 hover:text-gray-700"
        title="Later afronden (24 uur)"
        style={{ position: 'relative', zIndex: 2147483647, pointerEvents: 'auto' }}
      >
        Later afronden
      </button>

      {/* Vorige */}
      {onSecondary && (
        <button
          type="button"
          onMouseDown={activate(onSecondary)}
          onKeyDown={keyActivate(onSecondary)}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          {secondaryText}
        </button>
      )}

      {/* Volgende / Primaire */}
      <button
        type="button"
        onMouseDown={activate(onPrimary)}
        onKeyDown={keyActivate(onPrimary)}
        onClick={(e) => e.stopPropagation()}
        disabled={disabled}
        className="ml-auto inline-flex justify-center rounded-lg bg-black text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        style={{ position: 'relative', zIndex: 2147483647, pointerEvents: 'auto' }}
        aria-disabled={disabled ? 'true' : 'false'}
      >
        {primaryText}
      </button>
    </div>
  );

  // ===================== MODAL =====================
  const modal = (
    <div className="fixed inset-0 z-[2147483647]" role="dialog" aria-modal="true">
      {/* Backdrop laat kliks door */}
      <div className="absolute inset-0 z-0 bg-black/40 backdrop-blur-sm pointer-events-none" aria-hidden="true" />
      {/* Container vangt niets */}
      <div className="absolute inset-0 z-10 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
        {/* Alleen de kaart vangt kliks */}
        <div className="relative z-20 w-full max-w-xl rounded-2xl bg-white shadow-xl border pointer-events-auto">
          <div className="p-4 sm:p-5 border-b">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-semibold text-gray-800">Snel aan de slag</h2>
              <div className="text-xs text-gray-500">Stap {step} / {totalSteps}</div>
            </div>
            <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
              <div className="h-2 bg-blue-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {/* Stap 1 */}
            {step === 1 && (
              <>
                <p className="text-sm text-gray-700 mb-4">Vul je gegevens in. We gebruiken dit voor je account en in de welkomstmail.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Voornaam <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Voornaam"
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Achternaam <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Achternaam"
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefoon (optioneel)</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+31 6 12 34 56 78"
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>

                <ActionBar
                  onPrimary={saveProfile}
                  primaryText={loading ? 'Opslaan…' : 'Volgende'}
                  disabled={loading}
                />
              </>
            )}

            {/* Stap 2 */}
            {step === 2 && (
              <>
                <p className="text-sm text-gray-700 mb-4">Wat is je rol in jouw organisatie?</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {roleOptions.map((opt) => (
                    <button
                      type="button"
                      key={opt}
                      onMouseDown={activate(() => setRole(opt))}
                      onKeyDown={keyActivate(() => setRole(opt))}
                      onClick={(e) => e.stopPropagation()}
                      className={`rounded-lg border px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                        role === opt ? 'border-blue-600 ring-2 ring-blue-200' : ''
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <ActionBar
                  onPrimary={saveRole}
                  primaryText={loading ? 'Opslaan…' : 'Volgende'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
                  disabled={loading}
                />
              </>
            )}

            {/* Stap 3 (owner): script tonen + checken */}
            {step === 3 && isOwner && (
              <>
                <p className="text-sm text-gray-700">
                  Plaats dit script in de &lt;head&gt; van je website. Daarna kun je hieronder de installatie testen.
                </p>

                {/* SCRIPT BLOK (zelfde als account.js) */}
                <div className="mt-4 relative">
                  <pre className="bg-gray-100 border rounded p-4 text-sm overflow-x-auto">
                    {trackingScript || '…'}
                  </pre>
                  <button
                    type="button"
                    onMouseDown={activate(async () => {
                      if (!trackingScript) return;
                      try {
                        await navigator.clipboard.writeText(trackingScript);
                        setCopyMsg('Script gekopieerd!');
                        setTimeout(() => setCopyMsg(''), 2000);
                      } catch (e) {
                        setCopyMsg('Kopiëren mislukt; selecteer en kopieer handmatig.');
                        setTimeout(() => setCopyMsg(''), 3000);
                      }
                    })}
                    onKeyDown={keyActivate(async () => {
                      if (!trackingScript) return;
                      try {
                        await navigator.clipboard.writeText(trackingScript);
                        setCopyMsg('Script gekopieerd!');
                        setTimeout(() => setCopyMsg(''), 2000);
                      } catch {}
                    })}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded hover:bg-blue-700"
                  >
                    Kopieer
                  </button>
                </div>
                {copyMsg && <p className="text-green-600 text-sm mt-2">{copyMsg}</p>}

                {/* One-shot validatie */}
                <div className="mt-4">
                  <button
                    type="button"
                    onMouseDown={activate(validateOnce)}
                    onKeyDown={keyActivate(validateOnce)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!orgId || validating}
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {validating ? 'Valideren…' : 'Valideer installatie'}
                  </button>
                  {validateMsg && (
                    <div className={`mt-2 text-sm ${
                      validateMsg.type === 'success'
                        ? 'text-green-700'
                        : validateMsg.type === 'info'
                        ? 'text-blue-700'
                        : 'text-red-700'
                    }`}>
                      {validateMsg.text}
                    </div>
                  )}
                </div>

                {/* Continue polling als alternatief */}
                <div className="mt-6 flex items-center gap-2">
                  {!polling ? (
                    <button
                      type="button"
                      onMouseDown={activate(startPolling)}
                      onKeyDown={keyActivate(startPolling)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                    >
                      Start automatische check
                    </button>
                  ) : (
                    <button
                      type="button"
                      onMouseDown={activate(stopPolling)}
                      onKeyDown={keyActivate(stopPolling)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                    >
                      Stop automatische check
                    </button>
                  )}
                  <span className="text-sm text-gray-600">
                    Status:{' '}
                    {pollStatus === 'idle' && 'klaar om te starten'}
                    {pollStatus === 'checking' && 'controleren…'}
                    {pollStatus === 'not_found' && 'nog niets gezien'}
                    {pollStatus === 'ok' && '✅ script gezien'}
                    {pollStatus === 'error' && 'fout bij check'}
                  </span>
                </div>

                <ActionBar
                  onPrimary={() => setStep((s) => s + 1)}
                  primaryText={pollStatus === 'ok' ? 'Volgende' : 'Sla voorlopig over'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
                  disabled={loading}
                />
              </>
            )}

            {/* Stap 3 (niet-owner) of stap 4 (owner) – afronden */}
            {((!isOwner && step === 3) || (isOwner && step === 4)) && (
              <>
                <h3 className="text-base font-semibold text-gray-800 mb-2">Klaar! 🎉</h3>
                <p className="text-sm text-gray-700">
                  Je account staat. Je kunt direct verder in het dashboard. Je welkomstmail is verstuurd na het kiezen van je rol.
                </p>
                <ActionBar
                  onPrimary={complete}
                  primaryText={loading ? 'Afronden…' : 'Naar dashboard'}
                  onSecondary={() => setStep((s) => Math.max(1, s - 1))}
                  secondaryText="Vorige"
                  disabled={loading}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(modal, document.body) : modal;
}
