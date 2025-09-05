// upsertIpEnrichmentCache.js
import { supabaseAdmin } from './supabaseAdminClient.js';

// Laat undefined weg zodat we bestaande waarden niet met null overschrijven
const prune = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export async function upsertIpEnrichmentCache(ip, enrichment = {}) {
  if (!ip) return;

  // Haal bestaande rij op; geen error als hij niet bestaat
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('ip_enrichment_cache')
    .select('*')
    .eq('ip', ip)
    .maybeSingle();

  if (fetchError) {
    console.error('❌ Ophalen ip_enrichment_cache:', fetchError.message);
    return;
  }

  const now = new Date().toISOString();

  // Confidence samenstellen (nieuwe waardes hebben voorrang)
  const confNew = typeof enrichment.confidence === 'number' ? enrichment.confidence : undefined;
  const autoConfNew =
    typeof enrichment.auto_confidence === 'number' ? enrichment.auto_confidence : confNew;

  // Alleen velden meesturen die we daadwerkelijk hebben
  const payload = prune({
    ip,
    lat: enrichment.lat ?? undefined,
    lon: enrichment.lon ?? undefined,
    radius: enrichment.radius ?? undefined,
    geohash: enrichment.geohash ?? undefined,
    maps_result: enrichment.maps_result ?? undefined,
    confidence: confNew ?? undefined,
    confidence_reason: enrichment.confidence_reason ?? enrichment.auto_confidence_reason ?? undefined,
    phone: enrichment.phone ?? undefined,
    email: enrichment.email ?? undefined,
    linkedin_url: enrichment.linkedin_url ?? undefined,
    facebook_url: enrichment.facebook_url ?? undefined,
    instagram_url: enrichment.instagram_url ?? undefined,
    twitter_url: enrichment.twitter_url ?? undefined,
    meta_description: enrichment.meta_description ?? undefined,
    auto_confidence: autoConfNew ?? undefined,
    auto_confidence_reason: enrichment.auto_confidence_reason ?? enrichment.confidence_reason ?? undefined,
    enriched_at: now
  });

  const betterNumber = (a, b) =>
    (typeof a === 'number' ? a : -1) > (typeof b === 'number' ? b : -1);

  // Alleen updaten als het echt een verbetering is
  const improved =
    !existing ||
    (!existing.phone && payload.phone) ||
    (!existing.email && payload.email) ||
    (!existing.lat && payload.lat) ||
    (!existing.lon && payload.lon) ||
    (!existing.linkedin_url && payload.linkedin_url) ||
    (!existing.meta_description && payload.meta_description) ||
    betterNumber(payload.confidence, existing.confidence) ||
    betterNumber(payload.auto_confidence, existing.auto_confidence);

  if (!improved) {
    console.log('⚠️ Geen verbetering → ip-cache ongewijzigd:', ip);
    return;
  }

  if (existing) {
    const { error: updErr } = await supabaseAdmin
      .from('ip_enrichment_cache')
      .update(payload)
      .eq('ip', ip);
    if (updErr) {
      console.error('❌ Bijwerken ip_enrichment_cache:', updErr.message);
    } else {
      console.log('🆙 IP-cache bijgewerkt:', ip);
    }
  } else {
    const { error: insErr } = await supabaseAdmin
      .from('ip_enrichment_cache')
      .insert(payload);
    if (insErr) {
      console.error('❌ Invoegen ip_enrichment_cache:', insErr.message);
    } else {
      console.log('✅ IP-cache nieuw aangemaakt:', ip);
    }
  }
}
