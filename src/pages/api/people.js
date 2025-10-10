// pages/api/people.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { scrapePeopleForDomain } from '../../lib/peopleScraper';

// Helper: check lock verlopen
function lockExpired(row) {
  if (!row?.processing) return true;
  const started = row.processing_started_at ? new Date(row.processing_started_at).getTime() : 0;
  const ttl = (row.processing_lock_ttl_sec || 300) * 1000;
  return Date.now() - started > ttl;
}

// Upsert-beslisregel: alleen vervangen als beter
function isImproved(oldRow, neu) {
  if (!oldRow) return true;
  if ((neu.people_count || 0) > (oldRow.people_count || 0)) return true;
  if ((neu.source_quality || 0) > (oldRow.source_quality || 0)) return true;
  if (neu.team_page_hash && neu.team_page_hash !== oldRow.team_page_hash && (neu.people_count || 0) >= 1) return true;
  const statusOrder = { empty:0, error:1, blocked:2, no_team:3, stale:4, fresh:5 };
  if ((statusOrder[oldRow.status] ?? 0) < (statusOrder[neu.status] ?? 0)) return true;
  return false;
}

// Cooldown bepalen
function nextAllowedOnSuccess(ttlDays) {
  const d = new Date();
  d.setDate(d.getDate() + (ttlDays || 14));
  return d.toISOString();
}
function nextAllowedOnTempError(retryCount) {
  const mins = Math.min(24*60, Math.pow(2, Math.max(0, retryCount)) * 15);
  const d = new Date();
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const domain = (req.query.domain || '').toString().trim().toLowerCase();
  const wantRefresh = req.query.refresh === '1';

  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({ error: 'Ongeldig domein' });
  }

  // 1) Haal cache (of init)
  let { data: row, error } = await supabaseAdmin
    .from('people_cache')
    .select('*')
    .eq('company_domain', domain)
    .single();

  if (error && error.code === 'PGRST116') {
    // record bestaat nog niet → init
    const init = {
      company_domain: domain,
      status: 'empty',
      people: [],
      people_count: 0,
      ttl_days: 14,
      next_allowed_crawl_at: new Date(0).toISOString(), // direct toegestaan
    };
    const { data: inserted } = await supabaseAdmin
      .from('people_cache')
      .insert(init)
      .select('*')
      .single();
    row = inserted;
  } else if (error) {
    return res.status(500).json({ error: 'DB fout (select)', detail: error.message });
  }

  // 2) Stuur L0 meteen terug (snelle UX)
  res.setHeader('Cache-Control', 'no-store');
  const l0Payload = {
    company_domain: row.company_domain,
    status: row.status,
    last_verified: row.last_verified,
    ttl_days: row.ttl_days,
    people_count: row.people_count,
    people: row.people,
    team_page_url: row.team_page_url,
    evidence_urls: row.evidence_urls || [],
    detection_reason: row.detection_reason,
    source_quality: row.source_quality || 0,
    next_allowed_crawl_at: row.next_allowed_crawl_at,
  };
  res.status(200).json(l0Payload);

  // 3) Mag L1 draaien? (refresh aangevraagd óf TTL voorbij)
  try {
    const now = new Date();
    const canByTime = !row.next_allowed_crawl_at || new Date(row.next_allowed_crawl_at) <= now;
    const shouldRefresh = wantRefresh || canByTime || row.status === 'empty';

    if (!shouldRefresh) return;

    // 4) Lock zetten (optimistisch): alleen als niet processing of lock verlopen
    const mayLock = !row.processing || lockExpired(row);
    if (!mayLock) return;

    const { data: locked, error: lockErr } = await supabaseAdmin
      .from('people_cache')
      .update({ processing: true, processing_started_at: new Date().toISOString() })
      .eq('company_domain', domain)
      .eq('processing', row.processing) // voorkomt race
      .select('*')
      .single();

    if (lockErr || !locked) return; // iemand anders was sneller

    // 5) Scrapen
    let outcome;
    try {
      const result = await scrapePeopleForDomain(domain);

      if (result.accept) {
        // Succes: fresh of stale
        const status = result.people_count >= 1 ? 'fresh' : 'no_team';
        outcome = {
          status,
          people: result.people,
          people_count: result.people_count,
          team_page_url: result.team_page_url,
          team_page_hash: result.team_page_hash,
          team_page_etag: result.etag || null,
          team_page_last_modified: result.last_modified ? new Date(result.last_modified).toISOString() : null,
          evidence_urls: result.evidence_urls || [],
          detection_reason: result.detection_reason,
          source_quality: result.source_quality || 0,
          last_verified: new Date().toISOString(),
          retry_count: 0,
          next_allowed_crawl_at: nextAllowedOnSuccess(locked.ttl_days),
          last_error_code: null,
          last_error_at: null,
          render_state: 'not_needed',
        };
            } else {
        // Niet geaccepteerd → no_team of (mogelijk) render nodig
        // Bewaar ALTIJD de bekeken URL + hash/headers, zodat we weten welke pagina beoordeeld is
        const mergedEvidence = Array.from(new Set([
          ...(locked.evidence_urls || []),
          ...(result.evidence_urls || []),
          ...(result.url ? [result.url] : []),
        ]));

        outcome = {
          status: 'no_team',
          people: locked.people,                 // hou vorige mensen (indien er waren) vast
          people_count: locked.people_count,     // en tel
          team_page_url: result.url || locked.team_page_url || null, // <<-- BEWAAR URL
          team_page_hash: result.team_page_hash || locked.team_page_hash || null,
          team_page_etag: result.etag || locked.team_page_etag || null,
          team_page_last_modified: result.last_modified
            ? new Date(result.last_modified).toISOString()
            : (locked.team_page_last_modified || null),
          evidence_urls: mergedEvidence,         // <<-- voeg URL toe aan bewijs
          detection_reason: result.reason || 'no-accept',
          source_quality: Math.max(locked.source_quality || 0, result.source_quality || 0),
          last_verified: new Date().toISOString(),
          retry_count: (locked.retry_count || 0) + 1,
          next_allowed_crawl_at: nextAllowedOnTempError((locked.retry_count || 0) + 1),
          last_error_code: null,
          last_error_at: null,
          render_state: 'needed',
        };
      }

    } catch (e) {
      // Tijdelijke fout → backoff
      outcome = {
        status: locked.status === 'empty' ? 'error' : locked.status,
        people: locked.people,
        people_count: locked.people_count,
        team_page_url: locked.team_page_url,
        team_page_hash: locked.team_page_hash,
        team_page_etag: locked.team_page_etag,
        team_page_last_modified: locked.team_page_last_modified,
        evidence_urls: locked.evidence_urls,
        detection_reason: `error:${e.message}`,
        source_quality: locked.source_quality || 0,
        last_verified: locked.last_verified,
        retry_count: (locked.retry_count || 0) + 1,
        next_allowed_crawl_at: nextAllowedOnTempError((locked.retry_count || 0) + 1),
        last_error_code: e.message,
        last_error_at: new Date().toISOString(),
        render_state: locked.render_state || 'unknown',
      };
    }

    // 6) Upsert-beslissing
    const improved = isImproved(locked, outcome);

    const patch = {
      ...(improved ? {
        status: outcome.status,
        people: outcome.people,
        people_count: outcome.people_count,
        team_page_url: outcome.team_page_url,
        team_page_hash: outcome.team_page_hash,
        team_page_etag: outcome.team_page_etag,
        team_page_last_modified: outcome.team_page_last_modified,
        evidence_urls: outcome.evidence_urls,
        detection_reason: outcome.detection_reason,
        source_quality: outcome.source_quality,
        last_verified: outcome.last_verified,
      } : {
        // alleen housekeeping
        detection_reason: outcome.detection_reason,
        source_quality: Math.max(locked.source_quality || 0, outcome.source_quality || 0),
        last_verified: outcome.last_verified || locked.last_verified,
      }),
      retry_count: outcome.retry_count,
      next_allowed_crawl_at: outcome.next_allowed_crawl_at,
      last_error_code: outcome.last_error_code,
      last_error_at: outcome.last_error_at,
      render_state: outcome.render_state || locked.render_state,
      processing: false,
    };

    await supabaseAdmin
      .from('people_cache')
      .update(patch)
      .eq('company_domain', domain);

  } catch {
    // Als er onderweg iets misgaat, lock proberen uit te zetten
    await supabaseAdmin.from('people_cache')
      .update({ processing: false })
      .eq('company_domain', domain);
  }
}
