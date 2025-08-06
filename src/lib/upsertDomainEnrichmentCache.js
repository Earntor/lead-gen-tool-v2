import { supabaseAdmin } from './supabaseAdminClient.js';

export async function upsertDomainEnrichmentCache(domain, enrichment) {
  if (!domain) return;

  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('domain_enrichment_cache')
      .select('*')
      .eq('company_domain', domain)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('❌ Fout bij ophalen domain_enrichment_cache:', fetchError.message);
      return;
    }

    const now = new Date().toISOString();

    const insertData = {
      company_domain: domain,
      company_name: enrichment.company_name || null,
      domain_address: enrichment.domain_address || null,
      domain_postal_code: enrichment.domain_postal_code || null,
      domain_city: enrichment.domain_city || null,
      domain_country: enrichment.domain_country || null,
      domain_lat: enrichment.domain_lat || null,
      domain_lon: enrichment.domain_lon || null,
      category: enrichment.category || null,
      confidence: enrichment.confidence || null,
      confidence_reason: enrichment.confidence_reason || null,
      phone: enrichment.phone || null,
      email: enrichment.email || null,
      linkedin_url: enrichment.linkedin_url || null,
      facebook_url: enrichment.facebook_url || null,
      instagram_url: enrichment.instagram_url || null,
      twitter_url: enrichment.twitter_url || null,
      meta_description: enrichment.meta_description || null,
      enriched_at: now,
      auto_confidence: enrichment.confidence || null,
      auto_confidence_reason: enrichment.confidence_reason || null
    };

    const isImproved =
      !existing ||
      (!existing.phone && insertData.phone) ||
      (!existing.email && insertData.email) ||
      (!existing.domain_lat && insertData.domain_lat) ||
      (!existing.linkedin_url && insertData.linkedin_url) ||
      (!existing.category && insertData.category) ||
      (insertData.confidence > (existing.confidence || 0));

    if (isImproved) {
      if (existing) {
        const { error: updateError } = await supabaseAdmin
          .from('domain_enrichment_cache')
          .update({ ...insertData, enriched_at: now })
          .eq('company_domain', domain);

        if (updateError) {
          console.error('❌ Fout bij bijwerken van domain_enrichment_cache:', updateError.message);
        } else {
          console.log('🆙 Domeincache bijgewerkt:', domain);
        }
      } else {
        const { error: insertError } = await supabaseAdmin
          .from('domain_enrichment_cache')
          .insert(insertData);

        if (insertError) {
          console.error('❌ Fout bij invoegen in domain_enrichment_cache:', insertError.message);
        } else {
          console.log('✅ Domeincache nieuw aangemaakt:', domain);
        }
      }
    } else {
      console.log('⚠️ Geen verbetering → domeincache blijft ongewijzigd:', domain);
    }
  } catch (e) {
    console.error('❌ Fout in upsertDomainEnrichmentCache():', e.message);
  }
}
