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

    // Starttijd per pagina
    const startTime = Date.now();

    function send(eventType, durationSeconds) {
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
        durationSeconds,
        eventType // "load" of "end"
      };

      fetch(`${baseUrl}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
    }

    // ✅ 1) Meteen een pageview sturen bij page load (zorgt dat de homepage nooit mist)
    // duur = 0 bij start
    if (document.readyState === "complete" || document.readyState === "interactive") {
      send("load", 0);
    } else {
      window.addEventListener("DOMContentLoaded", () => send("load", 0), { once: true });
    }

    // ✅ 2) Bij verlaten/tab verbergen nog een keer sturen met werkelijke duur (gecappt server-side)
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      const seconds = Math.round((Date.now() - startTime) / 1000);
      send("end", seconds);
    });

    // Extra vangnet als iemand het tab sluit zonder visibilitychange
    window.addEventListener("pagehide", () => {
      const seconds = Math.round((Date.now() - startTime) / 1000);
      send("end", seconds);
    });
  } catch (err) {
    console.warn("Tracking script error:", err);
  }
})();
