// lib/sendLead.js

// Haal een waarde op uit de URL (zoals utm_source)
function getUTMParam(param) {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Genereer of haal bestaande anon_id uit localStorage
function getOrCreateAnonId() {
  let anonId = localStorage.getItem("anon_id");
  if (!anonId) {
    anonId = crypto.randomUUID();
    localStorage.setItem("anon_id", anonId);
  }
  return anonId;
}

export async function sendLead({ user_id }) {
  try {
    if (!user_id) {
      throw new Error("user_id is verplicht in sendLead");
    }

    const page_url = window.location.href;
    const referrer = document.referrer || null;
    const startTime = Date.now();
    const anon_id = getOrCreateAnonId();
    const utm_source = getUTMParam("utm_source");
    const utm_medium = getUTMParam("utm_medium");
    const utm_campaign = getUTMParam("utm_campaign");

    const duration_seconds = Math.round((Date.now() - startTime) / 1000);

    const payload = {

      user_id,
      page_url,
      anon_id,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      timestamp: new Date().toISOString(),
      duration_seconds,
    };

    const res = await fetch("/api/lead", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Fout bij versturen van lead");
    }

    console.log("✅ Lead verstuurd:", data.message || "success");
  } catch (err) {
    console.error("❌ sendLead fout:", err.message);
  }
}
