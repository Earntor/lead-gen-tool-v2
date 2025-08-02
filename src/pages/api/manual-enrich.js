import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import handler from './lead'; // jouw bestaande lead.js

export default async function manualEnrichRunner(req, res) {
  const { data, error } = await supabaseAdmin
    .from('ipapi_cache')
    .select('ip_address')
    .eq('manual_enrich', true)
    .limit(10);

  if (error || !data || data.length === 0) {
    return res.status(200).json({ message: 'Niets te verrijken' });
  }

  for (const row of data) {
    await handler({
      method: 'POST',
      body: {
        ip_address: row.ip_address,
        page_url: 'https://example.com',
        site_id: 'manual'
      }
    }, {
      status: () => ({ json: () => {} })
    });

    await supabaseAdmin
      .from('ipapi_cache')
      .update({ manual_enrich: false })
      .eq('ip_address', row.ip_address);
  }

  res.status(200).json({ message: 'Handmatige enrichment uitgevoerd' });
}
