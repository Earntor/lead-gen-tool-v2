(function () {
  try {
    // ⛔️ STOP als we op het dashboard zitten (leadtool.nl of subdomeinen daarvan)
    const currentHost = window.location.hostname;
    if (currentHost.endsWith("leadtool.nl")) {
      console.log("Tracking gestopt: dit is het dashboard.");
      return;
    }

    const scriptTag = document.currentScript;
    const projectId = scriptTag.getAttribute("data-project-id");
    if (!projectId) return;

    let anonId = localStorage.getItem("anonId");
    if (!anonId) {
      anonId = crypto.randomUUID();
      localStorage.setItem("anonId", anonId);
    }

    const pageUrl = window.location.href;
    const referrer = document.referrer;
    const utm = new URLSearchParams(window.location.search);
    const utmSource = utm.get("utm_source") || null;
    const utmMedium = utm.get("utm_medium") || null;
    const utmCampaign = utm.get("utm_campaign") || null;

    const startTime = Date.now();

    window.addEventListener("beforeunload", () => {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      fetch("https://leadtool.nl/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          projectId,
          pageUrl,
          referrer,
          anonId,
          utmSource,
          utmMedium,
          utmCampaign,
          durationSeconds,
        }),
      });
    });
  } catch (err) {
    console.warn("Tracking script error:", err);
  }
})();
