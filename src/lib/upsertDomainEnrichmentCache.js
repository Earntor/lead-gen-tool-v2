// src/lib/upsertDomainEnrichmentCache.js
import { supabaseAdmin } from './supabaseAdminClient.js';

// Helper: verwijder undefined zodat we bestaande waarden niet per ongeluk overschrijven met null
const prune = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Upsert naar domain_enrichment_cache op basis van company_domain (PRIMARY KEY).
 * Houdt rekening met "verbetering": we updaten alleen als nieuwe data beter/aanvullend is.
 *
 * @param {string} companyDomain - bijv. "voorbeeld.nl"
 * @param {object} enrichment   - velden die in de tabel passen (zie payload hieronder)
 */
export async function upsertDomainEnrichmentCache(companyDomain, enrichment = {}) {
  if (!companyDomain || typeof companyDomain !== 'string') return;

  // 1) Bestaande rij ophalen
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('domain_enrichment_cache')
    .select('*')
    .eq('company_domain', companyDomain)
    .maybeSingle();

  if (fetchErr) {
    console.error('❌ Ophalen domain_enrichment_cache:', fetchErr.message);
    return;
  }

  const now = new Date().toISOString();

  // 2) Payload opbouwen (alleen aanwezige velden meesturen)
  const payload = prune({
    company_domain: companyDomain,
    company_name: enrichment.company_name ?? undefined,

    domain_address: enrichment.domain_address ?? undefined,
    domain_postal_code: enrichment.domain_postal_code ?? undefined,
    domain_city: enrichment.domain_city ?? undefined,
    domain_country: enrichment.domain_country ?? undefined,

    // aliases toegestaan (domain_lat/lon of lat/lon)
    domain_lat: enrichment.domain_lat ?? enrichment.lat ?? undefined,
    domain_lon: enrichment.domain_lon ?? enrichment.lon ?? undefined,

    category: enrichment.category ?? undefined,

    phone: enrichment.phone ?? undefined,
    email: enrichment.email ?? undefined,
    linkedin_url: enrichment.linkedin_url ?? undefined,
    facebook_url: enrichment.facebook_url ?? undefined,
    instagram_url: enrichment.instagram_url ?? undefined,
    twitter_url: enrichment.twitter_url ?? undefined,
    meta_description: enrichment.meta_description ?? undefined,

    confidence:
      typeof enrichment.confidence === 'number' ? enrichment.confidence : undefined,
    confidence_reason: enrichment.confidence_reason ?? undefined,

    enriched_at: now
  });

  // 3) Alleen updaten bij echte verbetering
  const betterNumber = (a, b) =>
    (typeof a === 'number' ? a : -1) > (typeof b === 'number' ? b : -1);

  const improved =
    !existing ||
    (!existing.company_name && payload.company_name) ||
    (!existing.domain_address && payload.domain_address) ||
    (!existing.domain_postal_code && payload.domain_postal_code) ||
    (!existing.domain_city && payload.domain_city) ||
    (!existing.domain_country && payload.domain_country) ||
    (!existing.domain_lat && payload.domain_lat) ||
    (!existing.domain_lon && payload.domain_lon) ||
    (!existing.category && payload.category) ||
    (!existing.phone && payload.phone) ||
    (!existing.email && payload.email) ||
    (!existing.linkedin_url && payload.linkedin_url) ||
    (!existing.facebook_url && payload.facebook_url) ||
    (!existing.instagram_url && payload.instagram_url) ||
    (!existing.twitter_url && payload.twitter_url) ||
    (!existing.meta_description && payload.meta_description) ||
    betterNumber(payload.confidence, existing?.confidence);

  if (!improved) {
    console.log('ℹ️ Geen verbetering → domain cache ongewijzigd:', companyDomain);
    return;
  }

  // 4) Insert of update uitvoeren
  if (existing) {
    const { error: updErr } = await supabaseAdmin
      .from('domain_enrichment_cache')
      .update(payload)
      .eq('company_domain', companyDomain);

    if (updErr) {
      console.error('❌ Bijwerken domain_enrichment_cache:', updErr.message);
    } else {
      console.log('🆙 Domain-cache bijgewerkt:', companyDomain);
    }
  } else {
    const { error: insErr } = await supabaseAdmin
      .from('domain_enrichment_cache')
      .insert(payload);

    if (insErr) {
      console.error('❌ Invoegen domain_enrichment_cache:', insErr.message);
    } else {
      console.log('✅ Domain-cache nieuw aangemaakt:', companyDomain);
    }
  }
}
