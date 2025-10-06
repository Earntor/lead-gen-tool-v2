(function () {
  try {
    // --- Vind het <script> element robuust ---
    const scriptEl = document.currentScript || (function () {
      const s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

    // --- Bepaal het origin van JOUW tracking-server (van de script src) ---
    let ORIGIN = window.location.origin;
    try { ORIGIN = new URL(scriptEl && scriptEl.src ? scriptEl.src : window.location.href).origin; } catch {}
    const TRACK_URL = ORIGIN + '/api/track';
    const TOKEN_URL = ORIGIN + '/api/ingest-token';

    // --- Parameters uit snippet ---
    const projectId = scriptEl && scriptEl.getAttribute('data-project-id') || null; // = org_id
    const siteId = window.location.hostname;

    // --- ALTIJD: Éénmalige VALIDATIE-PING (zonder token) ---
    // Dit zet organizations.last_tracking_ping én sites.last_ping_at (server patch nodig zoals besproken)
    (function sendValidationPing() {
      if (!projectId) return; // zonder org_id geen validatie
      try {
        fetch(TRACK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            validationTest: true,
            projectId: projectId,
            siteId: siteId,
            pageUrl: window.location.href
          }),
          keepalive: true
        }).catch(function () { /* stil */ });
      } catch { /* stil */ }
    })();

    // --- Vanaf hier: echte tracking. Respecteer DNT/bot, en sla vercel.app over ---
    const ua = navigator.userAgent || '';
    const dnt = (navigator.doNotTrack === '1' || window.doNotTrack === '1');
    const BOT_HINTS = /(bot|spider|crawl|slurp|bingbot|bingpreview|googlebot|applebot|baiduspider|yandexbot|duckduckbot|vercel-(screenshot|favicon)-bot|dataproviderbot)/i;

    // Niet tracken op je eigen dashboard domein
    if (window.location.hostname.endsWith('vercel.app')) return;
    // Respecteer DNT en bots voor echte tracking (validatie is hierboven al verstuurd)
    if (dnt || BOT_HINTS.test(ua)) return;

    // --- IDs ---
    let anonId = localStorage.getItem('anonId');
    if (!anonId) { anonId = crypto.randomUUID(); localStorage.setItem('anonId', anonId); }

    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('sessionId', sessionId); }

    // --- Context ---
    const pageUrl = window.location.href;
    const referrer = document.referrer || null;

    const utm = new URLSearchParams(window.location.search);
    const utmSource = utm.get('utm_source') || null;
    const utmMedium = utm.get('utm_medium') || null;
    const utmCampaign = utm.get('utm_campaign') || null;

    // --- Tijdmeting ---
    const startPerf = performance.now();
    let ended = false;
    let lastEndAt = 0;
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
        const exp = Date.now() + ONE_HOUR_MS;
        localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ token, exp }));
      } catch {}
    }
    function clearCachedToken() { try { localStorage.removeItem(TOKEN_CACHE_KEY); } catch {} }

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

    // Post met Bearer; bij 401 één keer token verversen + retry
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
          clearCachedToken();
          ingestToken = null;
          await getToken();
          if (ingestToken) res = await doPost();
        }
      } catch { /* stil */ }
    }

    async function sendLoad() {
      await sendSigned(basePayload({ eventType: 'load' }));
    }

    async function sendEndOnce(reason) {
      const now = Date.now();
      if (ended) return;
      if (now - lastEndAt < 1000) return;
      lastEndAt = now;

      ended = true;
      const seconds = Math.max(0, Math.round((performance.now() - startPerf) / 1000));
      if (!ingestToken) await getToken().catch(() => {});
      await sendSigned(basePayload({ durationSeconds: seconds, eventType: 'end', endReason: reason }));
    }

    (async () => {
      await getToken();
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        sendLoad();
      } else {
        window.addEventListener('DOMContentLoaded', () => { sendLoad(); }, { once: true });
      }
    })();

    window.addEventListener('pagehide', () => { sendEndOnce('pagehide'); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendEndOnce('visibilitychange');
    });

  } catch (err) {
    console.warn('Tracking script error:', err);
  }
})();
