// lib/peopleScraper.js
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

// Kleine fetch helper met nette UA en guards
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (LeadGenBot People/1.0; +https://example.com/contact)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) throw new Error(`Unsupported content-type: ${ct}`);
  const buf = await res.arrayBuffer();
  const sizeKb = Math.round(buf.byteLength / 1024);
  if (sizeKb < 30 || sizeKb > 2048) throw new Error(`HTML size out of range: ${sizeKb}KB`);
  return { html: Buffer.from(buf).toString('utf8'), res };
}

// Kandidate paden (NL + EN)
const CANDIDATE_PATHS = [
  '/team','/over-ons','/ons-team','/about','/about-us','/who-we-are',
  '/organisatie','/management','/bestuur','/wie-zijn-wij', '/het-team', '/mensen', '/directie'
];

// Utility: absolute URL maken vanaf root
function toAbs(root, path) {
  try {
    return new URL(path, root).toString();
  } catch {
    return null;
  }
}

// Naam schoonmaken voor hashing (NIET opslaan)
function normName(name) {
  return (name || '').toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim();
}

// Basic e-mail domein check
function sameDomain(email, companyDomain) {
  if (!email || !companyDomain) return false;
  const at = email.split('@')[1]?.toLowerCase();
  return !!at && at.endsWith(companyDomain.toLowerCase());
}

// Extract persoons-cards uit een $document
function extractPeople($, baseUrl) {
  const people = [];

  // 1) JSON-LD Person
  $('script[type="application/ld+json"]').each((_,el) => {
    try {
      const data = JSON.parse($(el).contents().text().trim());
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach(obj => {
        if (obj['@type'] === 'Person' || (Array.isArray(obj['@type']) && obj['@type'].includes('Person'))) {
          const full_name = obj.name?.toString().trim();
          if (!full_name) return;
          people.push({
            full_name,
            role_title: obj.jobTitle?.toString().trim() || null,
            email: obj.email?.toString().replace(/^mailto:/,'').trim() || null,
            phone: obj.telephone?.toString().trim() || null,
            linkedin_url: null,
            photo_url: obj.image?.toString().trim() || null,
            _evidence: ['jsonld'],
          });
        }
      });
    } catch {}
  });

  // 2) Heuristiek voor cards/lijsten
  const CARD_SELECTORS = [
    '.team-member','.team__member','.member','.person','.profile-card',
    '.staff','.employee','.card:has(.name), .card:has(h3), .card:has(h4)',
    'li:has(.name), li:has(h3), li:has(h4)'
  ];

  $(CARD_SELECTORS.join(',')).each((_, el) => {
    const $el = $(el);
    const full_name = ($el.find('.name').first().text()
      || $el.find('h3, h4').first().text()
      || $el.text()).replace(/\s+/g,' ').trim();

    if (!full_name || full_name.split(' ').length < 2) return; // geen voor+achternaam → skip ruis

    const role_title = ($el.find('.role,.title,.function').first().text()
      || '').replace(/\s+/g,' ').trim() || null;

    // contact links
    const links = $el.find('a[href]').map((_,a)=>$el.find(a).attr('href')).get();
    const email = links.find(h=>/^mailto:/i.test(h))?.replace(/^mailto:/i,'').trim() || null;
    const phone = links.find(h=>/^tel:/i.test(h))?.replace(/^tel:/i,'').replace(/\s+/g,'').trim() || null;
    const linkedin = links.find(h=>/linkedin\.com/i.test(h)) || null;

    // foto
    const photo_url =
      $el.find('img').first().attr('src')
        ? toAbs(baseUrl, $el.find('img').first().attr('src'))
        : null;

    people.push({
      full_name,
      role_title: role_title || null, // exact zoals gevonden
      email: email || null,
      phone: phone || null,
      linkedin_url: linkedin || null,
      photo_url,
      _evidence: ['card'],
    });
  });

  // 3) Fallback: lijsten met anchors
  $('a[href*="linkedin.com"]').each((_,a) => {
    const $a = $(a);
    const name = $a.text().replace(/\s+/g,' ').trim();
    if (name && name.split(' ').length >= 2) {
      people.push({
        full_name: name,
        role_title: null,
        email: null,
        phone: null,
        linkedin_url: $a.attr('href'),
        photo_url: null,
        _evidence: ['anchor-linkedin'],
      });
    }
  });

  return people;
}

// Kwaliteitscore en redenen
function scoreAndReason(people, pageContext) {
  // people_valid: naam + (rol of één van email/tel/linkedin/foto)
  const valid = people.filter(p =>
    p.full_name &&
    (p.role_title || p.email || p.phone || p.linkedin_url || p.photo_url)
  );

  let detection_reason = '';
  let source_quality = 0;

  const hasJsonLd = people.some(p => p._evidence?.includes('jsonld'));
  if (hasJsonLd) source_quality = Math.max(source_quality, 3);

  if (valid.length >= 2) {
    detection_reason = '>=2 personen met naam + (rol of contact/link)';
    source_quality = Math.max(source_quality, 2 + (hasJsonLd ? 1 : 0)); // 2..3
  } else if (valid.length === 1) {
    // 1-persoon-bedrijf: naam + minstens 2 signalen
    const p = valid[0];
    const signals = [
      !!p.role_title,
      !!p.linkedin_url,
      !!p.photo_url,
      !!p.email,
      !!p.phone
    ].filter(Boolean).length;

    if (signals >= 2) {
      detection_reason = '1 persoon met ≥2 sterke signalen (rol/email/phone/linkedin/foto)';
      source_quality = Math.max(source_quality, 2 + (hasJsonLd ? 1 : 0)); // 2..3
    } else {
      detection_reason = 'Onvoldoende bewijs voor 1-persoon-bedrijf';
      source_quality = Math.max(source_quality, hasJsonLd ? 2 : 1);
    }
  } else {
    detection_reason = 'Geen valide personen gevonden';
    source_quality = Math.max(source_quality, hasJsonLd ? 1 : 0);
  }

  // context bump bij page titles/headings met “team/about/over ons”
  if (/team|over\s?ons|about|wie\s?zijn\s?wij|organisatie|management|bestuur/i.test(pageContext || '')) {
    source_quality = Math.min(3, source_quality + 1);
  }

  return { source_quality, detection_reason, validPeople: valid };
}

// Public API: scrape people voor een domain root + teampagina discovery
export async function scrapePeopleForDomain(companyDomain) {
  const root = `https://${companyDomain.replace(/\/+$/,'')}`;
  const candidates = [...CANDIDATE_PATHS.map(p => toAbs(root, p))].filter(Boolean);

  // homepage heuristics voor extra kandidaten
  try {
    const { html } = await fetchHtml(root);
    const $ = cheerio.load(html);
    const anchors = $('a[href]').map((_,a)=>$(a).attr('href')).get()
      .map(h => toAbs(root, h))
      .filter(Boolean);
    const extra = anchors.filter(u => /team|over-?ons|about|who-we-are|organisatie|management|bestuur/i.test(u || ''));
    // maximaal 3 extra
    for (const u of extra.slice(0,3)) if (!candidates.includes(u)) candidates.push(u);
  } catch {/* homepage kan falen; geen ramp */}

  let best = null;

  for (const url of candidates.slice(0,12)) {
    try {
      const { html, res } = await fetchHtml(url);
      const $ = cheerio.load(html);

      // simpele page context (title + h1)
      const pageCtx = `${$('title').text()} | ${$('h1').first().text()}`.trim();

      const rawPeople = extractPeople($, url);

      // dedupe
      const uniq = [];
      const seen = new Set();
      for (const p of rawPeople) {
        const key = [
          normName(p.full_name),
          p.linkedin_url || p.email || p.phone || p.photo_url || ''
        ].join('|');
        if (normName(p.full_name).length === 0) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(p);
      }

      const { source_quality, detection_reason, validPeople } = scoreAndReason(uniq, pageCtx);

      // accepteren als team (>=2) of 1-persoon sterk bewijs
      const accept =
        validPeople.length >= 2 ||
        (validPeople.length === 1 && /1 persoon/.test(detection_reason));

      if (!accept) {
        // mogelijk render nodig
        best = best ?? {
          accept: false,
          url,
          reason: detection_reason,
          source_quality,
          team_page_hash: crypto.createHash('sha256').update(html).digest('hex'),
          etag: res.headers.get('etag'),
          last_modified: res.headers.get('last-modified')
        };
        continue;
      }

      const people = validPeople.map(p => ({
        full_name: p.full_name,
        role_title: p.role_title || null,       // exact overnemen
        email: p.email || null,
        phone: p.phone || null,
        linkedin_url: p.linkedin_url || null,
        photo_url: p.photo_url || null,
      }));

      const evidence_urls = [url];
      const team_page_hash = crypto.createHash('sha256').update(html).digest('hex');
      const etag = res.headers.get('etag');
      const last_modified = res.headers.get('last-modified');

      const result = {
        accept: true,
        people,
        people_count: people.length,
        team_page_url: url,
        evidence_urls,
        detection_reason,
        source_quality,
        team_page_hash,
        etag,
        last_modified
      };

      // Kies beste (hoogste quality) als er meerdere zijn
      if (!best || (best.source_quality ?? 0) < source_quality) best = result;

      // early exit bij hoge kwaliteit
      if (result.source_quality === 3) break;

    } catch (e) {
      // stil falen per kandidaat
      best = best ?? { accept: false, url, reason: `error:${e.message}` };
    }
  }

  if (!best) {
    return {
      accept: false,
      reason: 'no-candidates',
    };
  }

  return best;
}
