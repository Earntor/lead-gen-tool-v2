(function () {
  try {
    const currentHost = window.location.hostname;
    if (currentHost.endsWith("vercel.app")) {
      console.log("Tracking gestopt: dit is het dashboard.");
      return;
    }

    const scriptTag = document.currentScript;
    const projectId = scriptTag.getAttribute("data-project-id");
    if (!projectId) return;

    const siteId = window.location.hostname; // ✅ Automatisch ingevuld

    let anonId = localStorage.getItem("anonId");
    if (!anonId) {
      anonId = crypto.randomUUID();
      localStorage.setItem("anonId", anonId);
    }

    let sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("sessionId", sessionId);
    }

    const pageUrl = window.location.href;
    const referrer = document.referrer;
    const utm = new URLSearchParams(window.location.search);
    const utmSource = utm.get("utm_source") || null;
    const utmMedium = utm.get("utm_medium") || null;
    const utmCampaign = utm.get("utm_campaign") || null;

    const baseUrl = new URL(scriptTag.src).origin;
    const startTime = Date.now();

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;

      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      const payload = {
        projectId,
        siteId, // ✅ Verstuur mee
        pageUrl,
        referrer,
        anonId,
        sessionId,
        utmSource,
        utmMedium,
        utmCampaign,
        durationSeconds,
      };

      fetch(`${baseUrl}/api/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    });
  } catch (err) {
    console.warn("Tracking script error:", err);
  }
})();
