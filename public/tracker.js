(function () {
  try {
    // Basis-URL = waar dit script vandaan komt
    const ORIGIN = new URL((document.currentScript && document.currentScript.src) || window.location.href).origin;
    const TRACK_URL = ORIGIN + '/api/track';
    const TOKEN_URL = ORIGIN + '/api/ingest-token';

    // Niet tracken op je eigen dashboard
    if (window.location.hostname.endsWith('vercel.app')) return;

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

const startTime = Date.now();
    let ended = false;
    let ingestToken = null;

    // 1) Kort-levend token ophalen (server tekent JWT)
    async function getToken() {
      try {
        const r = await fetch(
          `${TOKEN_URL}?site=${encodeURIComponent(siteId)}&projectId=${encodeURIComponent(projectId || '')}`,
          { method: 'GET', cache: 'no-store', credentials: 'omit' }
        );
        if (!r.ok) return;
        const j = await r.json();
        ingestToken = j.token || null;
      } catch { /* stil */ }
    }

    // 2) Payload helper
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
        userAgent: navigator.userAgent || null,
        dnt: navigator.doNotTrack || null,
        chUa: (navigator.userAgentData && navigator.userAgentData.brands) ? navigator.userAgentData.brands : null,
        ...extra
      };
    }

    // 3) Versturen met Bearer token (geen HMAC headers meer nodig)
async function sendSigned(bodyObj) {
  if (!ingestToken) return; // zonder token niet posten
  const payload = JSON.stringify(bodyObj);

  return fetch(TRACK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ingestToken}`,
      'X-Site-Id': siteId
    },
    body: payload,
    keepalive: true
  }).catch(() => {});
}


    async function sendLoad() {
  await sendSigned(basePayload({ eventType: 'load' }));
}


    async function sendEndOnce(reason) {
      if (ended) return;
      ended = true;
      const seconds = Math.max(0, Math.round((performance.now() - startTime) / 1000));
      await sendSigned(basePayload({ durationSeconds: seconds, eventType: 'end', endReason: reason }));
    }

    // Start: eerst token, dan 'load'
    (async () => {
      await getToken();
      if (document.readyState === 'complete' || document.readyState === 'interactive') sendLoad();
      else window.addEventListener('DOMContentLoaded', () => { sendLoad(); }, { once: true });
    })();

    // Einde: duur sturen (één keer)
    window.addEventListener('pagehide', () => { sendEndOnce('pagehide'); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendEndOnce('visibilitychange');
    });

  } catch (err) {
    console.warn('Tracking script error:', err);
  }
})();
