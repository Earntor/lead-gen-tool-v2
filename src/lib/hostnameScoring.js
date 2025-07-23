// lib/hostnameScoring.js

export function scoreReverseDnsHostname(hostname, enrichment = {}) {
  if (!hostname) return 0;

  const lower = hostname.toLowerCase();
  const domain = lower.split('.').slice(-2).join('.');

  const blacklistKeywords = ['dynamic', 'client', 'customer', 'dsl', 'broadband', 'home', 'pool', 'ip'];
  const blacklistedDomains = [
    'kpn.net', 'ziggo.nl', 'glasoperator.nl', 't-mobilethuis.nl', 'chello.nl',
    'dynamic.upc.nl', 'vodafone.nl', 'xs4all.nl', 'home.nl',
    'client.t-mobilethuis.nl', 'ip.telfort.nl'
  ];

  // 1. VPN/proxy verkeer: uitgesloten
  if (lower.includes('vpn') || lower.includes('proxy')) return 0;

  // 2. ISP-consumentindicaties
  if (blacklistedDomains.includes(domain)) return 0.1;
  if (blacklistKeywords.some(k => lower.includes(k))) return 0.2;

  // 3. Exact match met domein
  const enrichedDomain = enrichment?.domain;
  const hasCompanyInfo =
    enrichment?.address || enrichment?.city || enrichment?.postal_code || enrichment?.phone;

  if (enrichedDomain && (lower === enrichedDomain.toLowerCase() || domain === enrichedDomain.toLowerCase())) {
    if (hasCompanyInfo) {
      return 1.0; // Perfect profiel
    } else {
      return 0.6; // Domeinmatch zonder bruikbare bedrijfsdata
    }
  }

  // 4. Structuur met bedrijfsdomeinachtig patroon
  const segments = lower.split('.');
  if (segments.length >= 3 && !lower.startsWith('ip')) return 0.5;
  if (segments.length === 2) return 0.4;

  // 5. Onbekende patronen
  return 0.3;
}

export function getConfidenceReason(score) {
  if (score >= 0.95) {
    return "Match op domein met verrijkte bedrijfsinformatie";
  } else if (score >= 0.6) {
    return "Match op domein zonder voldoende enrichment";
  } else if (score >= 0.5) {
    return "Zakelijk ogende subdomeinstructuur";
  } else if (score >= 0.3) {
    return "Onbekende hostname-structuur";
  } else if (score >= 0.2) {
    return "Mogelijk consumentennetwerk";
  } else if (score >= 0.1) {
    return "Consumentenhost of ISP-domein";
  } else {
    return "Waarschijnlijk VPN, proxy of dynamisch IP";
  }
}
