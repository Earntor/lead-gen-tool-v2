(function () {
  try {
    const currentHost = window.location.hostname;
    if (currentHost.endsWith("vercel.app")) {
      // Niet tracken op je eigen dashboard
      return;
    }

    const scriptTag = document.currentScript;
    const projectId = scriptTag.getAttribute("data-project-id");
    if (!projectId) return;

    const siteId = window.location.hostname; // automatisch
    const baseUrl = new URL(scriptTag.src).origin;

    // Anonieme ID per browser
    let anonId = localStorage.getItem("anonId");
    if (!anonId) {
      anonId = crypto.randomUUID();
      localStorage.setItem("anonId", anonId);
    }

    // Session ID per tab
    let sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("sessionId", sessionId);
    }

    const pageUrl = window.location.href;
    const referrer = document.referrer || null;

    const utm = new URLSearchParams(window.location.search);
    const utmSource = utm.get("utm_source") || null;
    const utmMedium = utm.get("utm_medium") || null;
    const utmCampaign = utm.get("utm_campaign") || null;

    // Starttijd per pagina (nauwkeuriger dan Date.now)
    const startTime = performance.now();

    // ⛔️ Zorg dat "end" maar één keer wordt verzonden
    let ended = false;

    function sendViaFetch(payload) {
      fetch(`${baseUrl}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    }

    // ✅ Betrouwbare verzending bij afsluiten/weggaan
    function sendEndOnce(reason) {
      if (ended) return;
      ended = true;
      const seconds = Math.max(0, Math.round((performance.now() - startTime) / 1000));
      const payload = {
        projectId,
        siteId,
        pageUrl,
        referrer,
        anonId,
        sessionId,
        utmSource,
        utmMedium,
        utmCampaign,
        durationSeconds: seconds,
        eventType: "end",
        endReason: reason
      };

      // Probeer eerst sendBeacon (werkt tijdens unload). Lukt dat niet: fallback naar fetch.
      try {
        const ok = navigator.sendBeacon(
          `${baseUrl}/api/track`,
          new Blob([JSON.stringify(payload)], { type: "application/json" })
        );
        if (!ok) sendViaFetch(payload);
      } catch {
        sendViaFetch(payload);
      }
    }

    function sendLoad() {
      const payload = {
        projectId,
        siteId,
        pageUrl,
        referrer,
        anonId,
        sessionId,
        utmSource,
        utmMedium,
        utmCampaign,
        durationSeconds: 0,
        eventType: "load"
      };
      sendViaFetch(payload);
    }

    // ✅ 1) Meteen een pageview sturen bij page load (duur = 0)
    if (document.readyState === "complete" || document.readyState === "interactive") {
      sendLoad();
    } else {
      window.addEventListener("DOMContentLoaded", () => sendLoad(), { once: true });
    }

    // ✅ 2) Bij verlaten/tab verbergen nog een keer sturen met werkelijke duur (één keer!)
    // Gebruik pagehide (betrouwbaarder in Safari/iOS); visibilitychange als vangnet
    window.addEventListener("pagehide", () => sendEndOnce("pagehide"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") sendEndOnce("visibilitychange");
    });

  } catch (err) {
    console.warn("Tracking script error:", err);
  }
})();
