// lib/getLikelyDomainFromSignals.js
// Berekent het meest waarschijnlijke domein op basis van domainSignals[].
// Input-items: { domain, source, confidence, confidence_reason? }
// Output: { domain, confidence, enrichment_source: 'final_likely', confidence_reason, breakdown }

import psl from 'psl';

const HARD_SOURCES = new Set(['reverse_dns', 'tls_cert', 'host_header', 'tls']);
const SOFT_SOURCES = new Set(['http_fetch', 'favicon_hash', 'website_scrape']);

// Baseline gewichten per bron (kalibreer later op eigen data)
const SOURCE_WEIGHT = {
  reverse_dns:    0.35,
  tls_cert:       0.30,  // incl. SNI confirm
  tls:            0.30,
  host_header:    0.20,
  http_fetch:     0.15,  // redirect/canonical/og/cookie/cors vallen hier ook onder
  favicon_hash:   0.15,  // bytes-hash of pHash
  website_scrape: 0.10
  // onbekende bronnen => 0
};

// eTLD+1 (apex) voor tie-break op “kortste betekenisvolle naam”
function apexOf(d) {
  try {
    const parsed = psl.parse(String(d || '').toLowerCase());
    return parsed && !parsed.error ? parsed.domain : d;
  } catch { return d; }
}

// Deterministische fallback bij perfecte gelijkstand
function stableHash(str) {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getLikelyDomainFromSignals(signals = []) {
  // 0) Schoon en normaliseer; negeer final_likely/cache_reuse als input
  const clean = (signals || [])
    .filter(s => s && s.domain && typeof s.confidence === 'number' && !Number.isNaN(s.confidence))
    .map(s => ({
      domain: String(s.domain).toLowerCase(),
      source: String(s.source || '').toLowerCase(),
      confidence: Math.max(0, Math.min(1, Number(s.confidence))),
      reason: s.confidence_reason || null
    }))
    .filter(s => s.source !== 'final_likely' && s.source !== 'cache_reuse');

  if (clean.length === 0) return null;

  // 1) Groepeer per domein
  const byDomain = new Map();
  for (const s of clean) {
    const arr = byDomain.get(s.domain) || [];
    arr.push(s);
    byDomain.set(s.domain, arr);
  }

  // 2) Score per domein (weighted voting + diminishing returns + diversiteitsbonus)
  const scored = [];
  for (const [domain, arr] of byDomain.entries()) {
    // per signaal: gewicht * confidence
    const withWeight = arr.map(x => {
      const w = SOURCE_WEIGHT[x.source] ?? 0;
      return { ...x, weight: w, wconf: w * x.confidence };
    }).sort((a, b) => b.wconf - a.wconf);

    // diminishing returns: top 3 volledig, rest halve weging
    let rawScore = 0;
    withWeight.forEach((x, i) => {
      const factor = i < 3 ? 1 : 0.5;
      rawScore += x.wconf * factor;
    });

    // diversiteitbonus: +0.02 per unieke bron boven 1 (max +0.06)
    const uniqueSources = new Set(withWeight.map(x => x.source));
    const diversityBonus = Math.min(Math.max(0, uniqueSources.size - 1) * 0.02, 0.06);
    rawScore += diversityBonus;

    // hard-evidence metrics voor tie-break
    const hardSignals = withWeight.filter(x => HARD_SOURCES.has(x.source));
    const hardMax = hardSignals.length ? Math.max(...hardSignals.map(x => x.confidence)) : 0;
    const hardCount = hardSignals.length;

    // SNI-confirm herkennen in reason (komt uit jouw TLS SNI stap: 'TLS SNI confirm')
    const hasSNI = withWeight.some(x =>
      x.source === 'tls_cert' && String(x.reason || '').toLowerCase().includes('sni confirm')
    );

    const breakdown = {
      totalSignals: arr.length,
      uniqueSources: Array.from(uniqueSources),
      diversityBonus,
      hardCount,
      hardMax,
      hasSNI,
      topContributors: withWeight.slice(0, 5).map(x => ({
        source: x.source, confidence: x.confidence, weight: x.weight, wconf: x.wconf, reason: x.reason
      }))
    };

    scored.push({
      domain,
      rawScore,
      hardMax,
      hardCount,
      hasSNI,
      apex: apexOf(domain),
      breakdown
    });
  }

  // 3) Tie-break volgorde
  scored.sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;        // hoogste score
    if (b.hardCount !== a.hardCount) return b.hardCount - a.hardCount;    // meeste hard-signals
    if (b.hardMax !== a.hardMax) return b.hardMax - a.hardMax;            // hoogste hard-max
    if (a.hasSNI !== b.hasSNI) return a.hasSNI ? -1 : 1;                  // SNI confirmed eerst
    if (a.apex.length !== b.apex.length) return a.apex.length - b.apex.length; // kortste apex
    return (stableHash(a.domain) - stableHash(b.domain));                 // deterministisch
  });

  const best = scored[0];

  // 4) Confidence normaliseren naar vriendelijk bereik (globale min/max-projectie)
  const minC = 0.55, maxC = 0.92;
  const rawVals = scored.map(s => s.rawScore);
  const minRaw = Math.min(...rawVals);
  const maxRaw = Math.max(...rawVals);
  let norm = best.rawScore;
  if (maxRaw > minRaw) {
    norm = minC + (best.rawScore - minRaw) * (maxC - minC) / (maxRaw - minRaw);
  } else {
    norm = (minC + maxC) / 2;
  }
  const confidence = Math.max(0.5, Math.min(0.95, Number(norm.toFixed(3))));

  const reasonParts = [];
  reasonParts.push(`weighted voting over ${clean.length} signals`);
  if (best.hardCount > 0) reasonParts.push(`${best.hardCount} hard signal(s)`);
  if (best.hasSNI) reasonParts.push('SNI confirmed');
  if (best.breakdown.diversityBonus > 0) reasonParts.push(`diversity +${best.breakdown.diversityBonus.toFixed(2)}`);

  return {
    domain: best.domain,
    confidence,
    enrichment_source: 'final_likely',
    confidence_reason: reasonParts.join(' · '),
    breakdown: best.breakdown
  };
}

export default getLikelyDomainFromSignals;
