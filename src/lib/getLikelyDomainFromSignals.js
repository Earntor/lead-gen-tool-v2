// lib/getLikelyDomainFromSignals.js
// Verwacht: domainSignals = [{ domain, source, confidence, confidence_reason? }, ...]
// Geeft null of: { domain, enrichment_source: 'final_likely', confidence, confidence_reason }

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function uniq(arr)   { return Array.from(new Set(arr.filter(Boolean))); }

// Per-bron max gewicht (cap). Zo voorkom je dat 1 bron te dominant wordt.
const SOURCE_CAP = {
  'reverse_dns':   0.90,
  'tls_cert':      0.90,  // inclusief SNI-bevestiging
  'http_fetch':    0.80,  // redirect/canonical/og/cookie/cors vallen hier ook onder
  'favicon_hash':  0.85,  // bytes-hash of pHash
  'host_header':   0.80,
  'final_likely':  0.90,  // zou niet als input moeten komen, maar voor de zekerheid
  'google_maps':   0.80,
  'website_scrape':0.70,
  'isp_baseline':  0.50,
  'ipapi_baseline':0.50,
  'cache_reuse':   0.60,
  // onbekende bronnen vallen terug op default
};
const DEFAULT_CAP = 0.75;

// Combineer gewichten met: 1 - Π(1 - w_i)
// Hierdoor tellen meerdere middelmatige signalen toch overtuigend op.
function combineEvidence(weights) {
  const capped = weights.map(w => clamp01(Math.min(w, 0.95)));
  return 1 - capped.reduce((acc, w) => acc * (1 - w), 1);
}

export function getLikelyDomainFromSignals(domainSignals) {
  if (!Array.isArray(domainSignals) || domainSignals.length === 0) return null;

  // 1) Groepeer per domein
  const byDomain = new Map();

  for (const s of domainSignals) {
    if (!s || !s.domain) continue;
    const domain = String(s.domain).toLowerCase();
    const source = String(s.source || 'unknown').toLowerCase();
    let w = Number(s.confidence);
    if (!Number.isFinite(w)) w = 0;
    w = clamp01(w);

    // cap per bron
    const cap = SOURCE_CAP[source] ?? DEFAULT_CAP;
    w = Math.min(w, cap);

    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { weightsBySource: new Map(), reasons: [], sources: new Set() };
      byDomain.set(domain, entry);
    }

    // Maximaal 2 zwaarste gewichten per bron meenemen (anti-ruis)
    const arr = entry.weightsBySource.get(source) || [];
    arr.push(w);
    arr.sort((a, b) => b - a);
    entry.weightsBySource.set(source, arr.slice(0, 2));

    entry.sources.add(source);
    if (s.confidence_reason) {
      entry.reasons.push(`${source}: ${s.confidence_reason}`);
    }
  }

  // 2) Combineer per domein
  let best = null;

  for (const [domain, entry] of byDomain.entries()) {
    const weights = [...entry.weightsBySource.values()].flat();
    if (weights.length === 0) continue;

    const combined = combineEvidence(weights);
    const confidence = clamp01(combined);

    // Bouw compacte reden op (max 6 redenen)
    const reason = uniq(entry.reasons).slice(0, 6).join(' | ') || 'combined evidence';

    if (!best || confidence > best.confidence) {
      best = {
        domain,
        enrichment_source: 'final_likely',
        confidence,
        confidence_reason: reason,
        // optioneel debug: sources: [...entry.sources]
      };
    }
  }

  // 3) Drempel — onder 0.5 vinden we te zwak
  if (!best || best.confidence < 0.5) return null;

  // Rond netjes af
  best.confidence = Math.round(best.confidence * 100) / 100;
  return best;
}
