// lib/getLikelyDomainFromSignals.js

export function getLikelyDomainFromSignals(domainSignals) {
  if (!Array.isArray(domainSignals) || domainSignals.length === 0) return null;

  // 1️⃣ Groepeer signalen per domein
  const grouped = {};
  for (const signal of domainSignals) {
    const domain = signal.domain;
    if (!grouped[domain]) {
      grouped[domain] = {
        domain,
        sources: [],
        totalConfidence: 0,
        signalCount: 0,
        reasons: []
      };
    }
    grouped[domain].sources.push(signal.source);
    grouped[domain].totalConfidence += signal.confidence || 0;
    grouped[domain].signalCount += 1;
    if (signal.confidence_reason) grouped[domain].reasons.push(signal.confidence_reason);
  }

  // 2️⃣ Bereken gemiddelde confidence + bonus voor meerdere signalen
  const scored = Object.values(grouped).map(entry => {
    const avgConfidence = entry.totalConfidence / entry.signalCount;
    const bonus = Math.min(0.1 * (entry.signalCount - 1), 0.15); // max +0.15 bonus
    const score = avgConfidence + bonus;

    return {
      domain: entry.domain,
      score,
      signalCount: entry.signalCount,
      avgConfidence,
      combinedReason: entry.reasons.join(' + ')
    };
  });

  // 3️⃣ Sorteer op hoogste score
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.5) return null; // ⛔ Te lage confidence

  return {
    domain: best.domain,
    enrichment_source: 'combined_signals',
    confidence: parseFloat(best.score.toFixed(2)),
    confidence_reason: `Signalen: ${best.combinedReason}`
  };
}
