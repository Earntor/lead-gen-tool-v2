// lib/sendLead.js
function getUTMParam(param) {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function getOrCreateAnonId() {
  let anonId = localStorage.getItem("anon_id");
  if (!anonId) {
    anonId = crypto.randomUUID();
    localStorage.setItem("anon_id", anonId);
  }
  return anonId;
}

export async function sendLead() {
  try {
    const ORIGIN = new URL((document.currentScript && document.currentScript.src) || window.location.href).origin;
    const TOKEN_URL = ORIGIN + '/api/ingest-token';
    const TRACK_URL = ORIGIN + '/api/track';

    const siteId = window.location.hostname;
    const anonId = getOrCreateAnonId();
    const sessionId = sessionStorage.getItem('sessionId') || crypto.randomUUID();
    sessionStorage.setItem('sessionId', sessionId);

    const pageUrl = window.location.href;
    const referrer = document.referrer || null;
    const utm_source = getUTMParam("utm_source");
    const utm_medium = getUTMParam("utm_medium");
    const utm_campaign = getUTMParam("utm_campaign");

    // 1) token ophalen
    const tr = await fetch(`${TOKEN_URL}?site=${encodeURIComponent(siteId)}`, { cache:'no-store', credentials:'omit' });
    if (!tr.ok) throw new Error('Kon ingest token niet ophalen');
    const { token } = await tr.json();

    // 2) lead posten naar /api/track
    const payload = {
      siteId,
      pageUrl,
      referrer,
      anonId,
      sessionId,
      utmSource: utm_source,
      utmMedium: utm_medium,
      utmCampaign: utm_campaign,
      eventType: 'end',          // forceer insert pad
      durationSeconds: 0         // geen duur (optioneel)
    };

    const res = await fetch(TRACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Site-Id': siteId
      },
      body: JSON.stringify(payload),
      keepalive: true
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fout bij versturen van lead');

    console.log("✅ Lead verstuurd via track:", data);
  } catch (err) {
    console.error("❌ sendLead fout:", err.message);
  }
}
