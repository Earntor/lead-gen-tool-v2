// pages/api/check-tracking.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role voor server-side check
);

const TTL_DAYS = 7;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id, X-Org-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  
  try {
    const { siteId, orgId } = req.query;
    const thresholdIso = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const toStatus = (last_ping_at) => {
      if (last_ping_at && last_ping_at >= thresholdIso) return { status: 'active' };
      return { status: 'not_found' };
    };

    // 1) Check per site
    if (siteId) {
      let query = supabase
        .from('sites')
        .select('id, site_id, org_id, last_ping_at')
        .eq('site_id', siteId)
        .limit(1);

      if (orgId) query = query.eq('org_id', orgId);

      const { data, error } = await query.single();
      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: 'db', detail: error.message });
      }
      if (!data) {
        return res.status(200).json({
          status: 'not_found',
          reason: 'site_not_found',
          siteId,
          ttl_days: TTL_DAYS,
        });
      }
      const result = toStatus(data.last_ping_at);
      return res.status(200).json({
        ...result,
        siteId: data.site_id,
        last_ping_at: data.last_ping_at,
        ttl_days: TTL_DAYS,
      });
    }

    // 2) Check per org: is er iéts actief binnen 7 dagen?
    if (orgId) {
      const { data, error } = await supabase
        .from('sites')
        .select('id, site_id, last_ping_at')
        .eq('org_id', orgId)
        .gte('last_ping_at', thresholdIso)
        .limit(1);

      if (error) {
        return res.status(500).json({ error: 'db', detail: error.message });
      }

      if (data && data.length > 0) {
        return res.status(200).json({
          status: 'active',
          any_active_site: data[0].site_id,
          last_ping_at: data[0].last_ping_at,
          ttl_days: TTL_DAYS,
        });
      } else {
        return res.status(200).json({
          status: 'not_found',
          reason: 'no_recent_pings',
          ttl_days: TTL_DAYS,
        });
      }
    }

    // 3) Parameters missen
    return res.status(400).json({ error: 'missing_parameters', message: 'Provide siteId or orgId' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: e.message });
  }
}
