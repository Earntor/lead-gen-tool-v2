import fetch from 'node-fetch';

/**
 * Probeer een fetch met een custom Host-header naar een IP.
 * Geen DB-logging hier; caller beslist wat te loggen.
 *
 * @param {string} ip
 * @param {string[]} domains - lijst van domeinen om te proberen
 * @param {{ timeoutMs?: number, requireBranding?: boolean, maxTrials?: number }} [opts]
 * @returns {{
 *   domain: string | null,
 *   confidence?: number,
 *   reason?: string,
 *   status_code?: number,
 *   snippet?: string,
 *   trials?: Array<{domain:string, ok:boolean, status?:number, snippet?:string}>
 * }}
 */
export async function probeHostHeader(
  ip,
  domains = [],
  { timeoutMs = 3000, requireBranding = true, maxTrials = 0 } = {}
) {
  const trials = [];

  for (const domain of domains) {
    try {
      const res = await fetch(`http://${ip}`, {
        headers: { Host: domain, 'User-Agent': 'LeadGenBot/1.0' },
        timeout: timeoutMs,
      });

      const text = await res.text();
      const snippet = text.slice(0, 500).toLowerCase();

      const branded = !requireBranding || snippet.includes(domain.split('.')[0]);
      const ok = res.status === 200 && branded;

      // optioneel wat trials teruggeven aan caller (géén DB-write)
      if (maxTrials > 0 && trials.length < maxTrials) {
        trials.push({
          domain,
          ok,
          status: res.status,
          snippet: snippet.slice(0, 200)
        });
      }

      if (ok) {
        return {
          domain,
          confidence: 0.85,
          reason: 'Host-header probing match op 200' + (requireBranding ? ' + branding' : ''),
          status_code: res.status,
          snippet,
          trials
        };
      }
    } catch {
      // stil falen; caller beslist of/hoe dit gelogd wordt
      if (maxTrials > 0 && trials.length < maxTrials) {
        trials.push({ domain, ok: false });
      }
      continue;
    }
  }

  return { domain: null, trials };
}
