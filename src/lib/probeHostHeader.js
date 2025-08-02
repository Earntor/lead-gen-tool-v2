import fetch from 'node-fetch';

/**
 * Probeer een fetch met een custom Host-header naar een IP
 * @param {string} ip
 * @param {string[]} domains - lijst van domeinen om te proberen
 * @returns {{ domain: string, confidence: number, reason: string } | null}
 */
export async function probeHostHeader(ip, domains = []) {
  for (const domain of domains) {
    try {
      const res = await fetch(`http://${ip}`, {
        headers: { Host: domain, 'User-Agent': 'LeadGenBot/1.0' },
        timeout: 3000,
      });

      const text = await res.text();
      const snippet = text.slice(0, 500).toLowerCase();

      const isValid = res.status === 200 && snippet.includes(domain.split('.')[0]);

      await logHostProbe(ip, domain, res.status, snippet, isValid);

      if (isValid) {
        return {
          domain,
          confidence: 0.85,
          reason: 'Host-header probing match op 200 + branding'
        };
      }
    } catch (err) {
      await logHostProbe(ip, domain, null, null, false);
      continue;
    }
  }

  return null;
}

// 👇 Supabase logging
import { supabaseAdmin } from './supabaseAdminClient';

async function logHostProbe(ip, domain, status, snippet, success) {
  try {
    await supabaseAdmin.from('host_probe_log').insert({
      ip_address: ip,
      tested_domain: domain,
      status_code: status,
      content_snippet: snippet ? snippet.slice(0, 500) : null,
      success,
    });
  } catch (e) {
    console.warn('⚠️ Logging host_probe_log faalde:', e.message);
  }
}
