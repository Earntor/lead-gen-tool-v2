// lib/logDomainSignal.js
import { supabaseAdmin } from './supabaseAdminClient.js';

export async function logDomainSignal({ ip_address, domain, source, confidence, confidence_reason }) {
  if (!ip_address || !domain || !source) return null;

  const signal = {
    domain,
    source,
    confidence: confidence || null,
    confidence_reason: confidence_reason || null
  };

  try {
    await supabaseAdmin.from('domain_signal_log').insert({
      ip_address,
      signals: [signal],
      chosen_domain: null,
      enrichment_source: source,
      confidence: confidence || null,
      confidence_reason: confidence_reason || null,
      logged_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('⚠️ Fout bij loggen van domain_signal:', e.message);
  }

  return signal;
}
