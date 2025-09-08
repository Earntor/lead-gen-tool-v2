(function () {
  try {
    const ORIGIN = new URL((document.currentScript && document.currentScript.src) || window.location.href).origin;
    const TRACK_URL = ORIGIN + '/api/track';
    const TOKEN_URL = ORIGIN + '/api/ingest-token';
    

    // Niet tracken op je eigen dashboard
    if (window.location.hostname.endsWith('vercel.app')) return;

    // 🛡️ Extra: respecteer DNT + simpele bot-check
    const ua = navigator.userAgent || '';
    const dnt = (navigator.doNotTrack === '1' || window.doNotTrack === '1');
    const BOT_HINTS = /(bot|spider|crawl|slurp|bingbot|bingpreview|googlebot|applebot|baiduspider|yandexbot|duckduckbot|vercel-(screenshot|favicon)-bot|dataproviderbot)/i;
    if (dnt || BOT_HINTS.test(ua)) return;

    const scriptTag = document.currentScript;
    const projectId = scriptTag?.getAttribute('data-project-id') || null;
    const siteId = window.location.hostname;

    // Anonieme ID per browser
    let anonId = localStorage.getItem('anonId');
    if (!anonId) { anonId = crypto.randomUUID(); localStorage.setItem('anonId', anonId); }

    // Session ID per tab
    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('sessionId', sessionId); }

    const pageUrl = window.location.href;
    const referrer = document.referrer || null;

    const utm = new URLSearchParams(window.location.search);
    const utmSource = utm.get('utm_source') || null;
    const utmMedium = utm.get('utm_medium') || null;
    const utmCampaign = utm.get('utm_campaign') || null;

    // Zelfde klok voor start én eind
    const startPerf = performance.now();
    let ended = false;
    let lastEndAt = 0; // race-guard tegen dubbel eind-event
    let ingestToken = null;

    // --- Token cache (1 uur) ---
    const TOKEN_CACHE_KEY = 'ingestTokenCache';
    const ONE_HOUR_MS = 60 * 60 * 1000;

    function getCachedToken() {
      try {
        const raw = localStorage.getItem(TOKEN_CACHE_KEY);
        if (!raw) return null;
        const { token, exp } = JSON.parse(raw);
        if (!token || !exp || Date.now() > exp) return null;
        return token;
      } catch { return null; }
    }

    function setCachedToken(token) {
      try {
        const exp = Date.now() + ONE_HOUR_MS; // 1 uur geldig
        localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ token, exp }));
      } catch {}
    }

    function clearCachedToken() {
      try { localStorage.removeItem(TOKEN_CACHE_KEY); } catch {}
    }

    async function getToken() {
      const cached = getCachedToken();
      if (cached) { ingestToken = cached; return; }
      try {
        const r = await fetch(
          `${TOKEN_URL}?site=${encodeURIComponent(siteId)}&projectId=${encodeURIComponent(projectId || '')}`,
          { method: 'GET', cache: 'no-store', credentials: 'omit', keepalive: true }
        );
        if (!r.ok) return;
        const j = await r.json();
        if (j?.token) {
          ingestToken = j.token;
          setCachedToken(j.token);
        }
      } catch { /* stil */ }
    }

    // Payload helper
    function basePayload(extra = {}) {
      return {
        projectId,
        siteId,
        pageUrl,
        referrer,
        anonId,
        sessionId,
        utmSource,
        utmMedium,
        utmCampaign,
        userAgent: ua,
        dnt: dnt ? '1' : '0',
        chUa: (navigator.userAgentData && navigator.userAgentData.brands) ? navigator.userAgentData.brands : null,
        ...extra
      };
    }

    // Post met Bearer, bij 401 één keer token verversen + retry
    async function sendSigned(bodyObj) {
      if (!ingestToken) return;
      const payload = JSON.stringify(bodyObj);

      const doPost = async () => fetch(TRACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ingestToken}`,
          'X-Site-Id': siteId
        },
        body: payload,
        keepalive: true
      });

      try {
        let res = await doPost();
        if (res && res.status === 401) {
          // token verlopen → cache leeg, opnieuw halen en één retry
          clearCachedToken();
          ingestToken = null;
          await getToken();
          if (ingestToken) {
            res = await doPost();
          }
        }
      } catch { /* stil */ }
    }

    // Beveiligde beacon: JWT als query-param, body als tekst (JSON-string)
function sendBeaconSigned(bodyObj) {
  try {
    if (!ingestToken) return false;
    const url = `${TRACK_URL}?beacon=1&jwt=${encodeURIComponent(ingestToken)}&site=${encodeURIComponent(siteId)}`;
    const payload = JSON.stringify(basePayload(bodyObj));
    return navigator.sendBeacon(url, payload);
  } catch {
    return false;
  }
}


    async function sendLoad() {
      await sendSigned(basePayload({ eventType: 'load' }));
    }

    async function sendEndOnce(reason) {
  const now = Date.now();
  if (ended) return;
  if (now - lastEndAt < 1000) return; // dubbele end binnen 1s voorkomen
  lastEndAt = now;
  ended = true;

  const seconds = Math.max(0, Math.round((performance.now() - startPerf) / 1000));

  // 1) Zorg dat we een token hebben (meestal al aanwezig)
  if (!ingestToken) {
    try { await getToken(); } catch {}
  }

  // 2) Probeer eerst beacon (overleeft navigatie/unload)
  const ok = sendBeaconSigned({ durationSeconds: seconds, eventType: 'end', endReason: reason });

  // 3) Fallback: fetch met keepalive (voor oudere browsers of als beacon faalt)
  if (!ok) {
    try {
      await sendSigned(basePayload({ durationSeconds: seconds, eventType: 'end', endReason: reason }));
    } catch {}
  }
}


    (async () => {
      await getToken();
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        sendLoad();
      } else {
        window.addEventListener('DOMContentLoaded', () => { sendLoad(); }, { once: true });
      }
    })();

    window.addEventListener('pagehide', () => { sendEndOnce('pagehide'); }, { once: true });
window.addEventListener('beforeunload', () => { sendEndOnce('beforeunload'); }, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sendEndOnce('visibilitychange');
}, { passive: true });


  } catch (err) {
    console.warn('Tracking script error:', err);
  }
})();
