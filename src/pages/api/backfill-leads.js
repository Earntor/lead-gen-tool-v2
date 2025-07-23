import { supabaseAdmin } from '../../lib/supabaseAdminClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔁 Start backfill voor leads zonder enrichment');

    const { data: incompleteLeads, error: selectError } = await supabaseAdmin
      .from('leads')
      .select('id, ip_address')
      .or('company_name.is.null,company_domain.is.null')
      .limit(100); // batch voor performance

    if (selectError) throw selectError;

    for (const lead of incompleteLeads) {
      const { id, ip_address } = lead;

      const { data: cache, error: cacheError } = await supabaseAdmin
        .from('ipapi_cache')
        .select('*')
        .eq('ip_address', ip_address)
        .single();

      if (cacheError || !cache || !cache.company_name) continue;

      const updateData = {
        company_name: cache.company_name,
        company_domain: cache.company_domain,
        domain_address: cache.domain_address,
        domain_postal_code: cache.domain_postal_code,
        domain_city: cache.domain_city,
        domain_country: cache.domain_country,
        confidence_reason: cache.confidence_reason,
      };

      const { error: updateError } = await supabaseAdmin
        .from('leads')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        console.error(`❌ Lead ${id} niet bijgewerkt:`, updateError.message);
      } else {
        console.log(`✅ Lead ${id} bijgewerkt met enrichment`);
      }
    }

    res.status(200).json({ success: true, updated: incompleteLeads.length });
  } catch (err) {
    console.error('❌ Fout tijdens backfill:', err.message);
    res.status(500).json({ error: err.message || 'Onbekende fout' });
  }
}
