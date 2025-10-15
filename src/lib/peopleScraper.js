// lib/peopleScraper.js
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

/* =========================
   0) Fetch helper (veilig)
   ========================= */
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
  // ✅ Volle desktop Chrome UA, geen “bot” hints
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8'
},

    redirect: 'follow',
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) throw new Error(`Unsupported content-type: ${ct}`);
  const buf = await res.arrayBuffer();
  const sizeKb = Math.round(buf.byteLength / 1024);
if (sizeKb < 5 || sizeKb > 4096) throw new Error(`HTML size out of range: ${sizeKb}KB`);

  return { html: Buffer.from(buf).toString('utf8'), res };
}

/* ======================================
   1) Kandidaten & handige util-functies
   ====================================== */
const CANDIDATE_PATHS = [
  '/team','/team/',
  '/over-ons','/over-ons/',
  '/ons-team','/ons-team/',
  '/about','/about/',
  '/about-us','/about-us/',
  '/who-we-are','/who-we-are/',
  '/organisatie','/organisatie/',
  '/management','/management/',
  '/bestuur','/bestuur/',
  '/wie-zijn-wij','/wie-zijn-wij/',
  '/het-team','/het-team/',
  '/mensen','/mensen/',
  '/directie','/directie/',
  '/board','/board/',
  '/leadership','/leadership/'
];


function toAbs(root, path) {
  try {
    return new URL(path, root).toString();
  } catch {
    return null;
  }
}

function normName(name) {
  return (name || '').toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim();
}

const NAME_STOPWORDS = [
  // Veelvoorkomende ruis op NL/EN sites
  'style guide','fout 404','404','not found','we konden de pagina',
  'overige ruimtes','ontvang onze e-mail nieuwsbrief','nieuwsbrief',
  'we maken het graag persoonlijk','privacy','cookies','algemene voorwaarden',
  'contact','services','oplossingen','producten','vacatures','werken bij',
  'aanmelden','inschrijven','projecten','cases','referenties',
  // Van Werven / Homemadeby-achtige koppen
  'capaciteit','integrale oplossingen','bouwstoffen',
  'kennis van regelgeving','van afval naar grondstof'
];

function isLikelyPersonName(name) {
  if (!name) return false;
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length < 4 || n.length > 80) return false;
  if (/\d/.test(n)) return false;                       // geen cijfers
  if ((n.match(/[^A-Za-zÀ-ÖØ-öø-ÿ'’\-\s]/g) || []).length > 2) return false;

  const lower = n.toLowerCase();
  if (NAME_STOPWORDS.some(s => lower.includes(s))) return false;
  if (/[!:]$/.test(n)) return false;                    // "zinachtige" koppen

  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;                   // minimaal voornaam + achternaam

  const tussen = new Set(['de','den','der','van','von','vom','la','le','di','da','du','del','della']);
  const isWordOk = (w) => {
    const lw = w.toLowerCase();
    if (tussen.has(lw)) return true;                    // tussenvoegsels ok
    return /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*$/.test(w);
  };

  const okCount = parts.filter(isWordOk).length;
  return okCount >= 2;
}

function isLikelyShortRole(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.length > 120) return false; // lange bio = geen rol
  // sluit duidelijk niet-rollen uit
  const bad = /(cookie|privacy|error|404|nieuwsbrief|inschrijven|afmelden|algemene voorwaarden)/i;
  return !bad.test(t);
}

function isLogoUrl(u) {
  if (!u) return false;
  const s = u.toLowerCase();
  return /logo|icon|favicon|sprite/.test(s);
}

function pickImageUrl($scope, baseUrl) {
  const img = $scope.find('img').first();
  if (!img.length) return null;

  let src =
    img.attr('src') ||
    img.attr('data-src') ||
    img.attr('data-lazy-src') ||
    null;

  if (!src) {
    const srcset = img.attr('srcset');
    if (srcset) {
      // pak eerste URL uit srcset
      src = srcset.split(',')[0].trim().split(' ')[0];
    }
  }

  const abs = src ? toAbs(baseUrl, src) : null;
  return abs && !isLogoUrl(abs) ? abs : null;
}


function pageLooksLike404OrNoise(title, h1Text, status) {
  const t = (title || '').toLowerCase();
  const h = (h1Text || '').toLowerCase();
  if (status === 404 || status === 410) return true;
  const bad = /(404|page not found|niet gevonden|oops|sorry|error)/i;
  return bad.test(t) || bad.test(h);
}

/* ======================================
   2) Extractie uit een HTML-document
   ====================================== */
function extractPeople($, baseUrl) {
  const people = [];

  // -- JSON-LD Person -------------------
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach(obj => {
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        if (types.includes('Person')) {
          const full_name = (obj.name || '').toString().trim();
          if (isLikelyPersonName(full_name)) {
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
        }
      });
    } catch { /* negeer kapotte JSON-LD */ }
  });

  // -- Cards / tile-achtige blokken -----
  const CARD_SELECTORS = [
    '.team-member','.team__member','.member','.person','.profile-card',
    '.staff','.employee','.card:has(.name),.card:has(h3),.card:has(h4)',
    'li:has(.name),li:has(h3),li:has(h4)'
  ];

  $(CARD_SELECTORS.join(',')).each((_, el) => {
    const $el = $(el);

    // ruwe titel
    const rawName = (
      $el.find('.name').first().text() ||
      $el.find('h3, h4').first().text() ||
      $el.text()
    ).replace(/\s+/g, ' ').trim();

    if (!isLikelyPersonName(rawName)) return;

    // rol (kort)
    const role_title = (
      $el.find('.role,.title,.function').first().text() || ''
    ).replace(/\s+/g, ' ').trim();
    const role = isLikelyShortRole(role_title) ? role_title : null;

    // contact links  (**BUGFIX**: gebruik $(a), niet $el.find(a) binnen map)
    const links = $el.find('a[href]').map((__, a) => $(a).attr('href')).get();
    const email = links.find(h => /^mailto:/i.test(h))?.replace(/^mailto:/i,'').trim() || null;
    const phone = links.find(h => /^tel:/i.test(h))?.replace(/^tel:/i,'').replace(/\s+/g,'').trim() || null;
    const linkedin = links.find(h => /linkedin\.com/i.test(h)) || null;

    // foto (ook lazy-src/srcset)
const photo_url = pickImageUrl($el, baseUrl);



    people.push({
      full_name: rawName,
      role_title: role,
      email,
      phone,
      linkedin_url: linkedin,
      photo_url: photo_url && !isLogoUrl(photo_url) ? photo_url : null,
      _evidence: ['card'],
    });
  });

  // -- Heading-gedreven blokken ----------
  $('h1, h2, h3').each((_, h) => {
    const $h = $(h);
    const full_name = $h.text().replace(/\s+/g, ' ').trim();
    if (!isLikelyPersonName(full_name)) return;

    const $ctx = $h.closest('section, article, div').length ? $h.closest('section, article, div') : $h.parent();

    let role_title = null;
    const $p = $ctx.find('p').filter(function () { return $(this).text().trim().length > 0; }).first();
    if ($p.length) {
      const txt = $p.text().replace(/\s+/g, ' ').trim();
      if (isLikelyShortRole(txt)) role_title = txt;
    }

    const links = $ctx.find('a[href]').map((__, a) => $(a).attr('href')).get();
    const email = links.find(href => /^mailto:/i.test(href))?.replace(/^mailto:/i, '').trim() || null;
    const phone = links.find(href => /^tel:/i.test(href))?.replace(/^tel:/i, '').replace(/\s+/g, '').trim() || null;
    const linkedin = links.find(href => /linkedin\.com/i.test(href)) || null;

const photo_url = pickImageUrl($ctx, baseUrl);


    people.push({
      full_name,
      role_title,
      email,
      phone,
      linkedin_url: linkedin,
      photo_url: photo_url && !isLogoUrl(photo_url) ? photo_url : null,
      _evidence: ['heading-block'],
    });
  });

  // -- Fallback: losse LinkedIn-anchors ---
  $('a[href*="linkedin.com"]').each((_, a) => {
    const $a = $(a);
    const name = $a.text().replace(/\s+/g,' ').trim();
    if (!isLikelyPersonName(name)) return;
    people.push({
      full_name: name,
      role_title: null,
      email: null,
      phone: null,
      linkedin_url: $a.attr('href'),
      photo_url: null,
      _evidence: ['anchor-linkedin'],
    });
  });

  return people;
}

/* ======================================
   3) Scoring + acceptance-beslisregel
   ====================================== */
function scoreAndReason(people, pageContext) {
  const ctxLooksLikeTeam = /team|over\s?ons|about|wie\s?zijn\s?wij|organisatie|management|bestuur/i.test(pageContext || '');

  const isValid = (p) => {
    if (!isLikelyPersonName(p.full_name)) return false;
    const shortRole = isLikelyShortRole(p.role_title || '');
    return shortRole || p.email || p.phone || p.linkedin_url || p.photo_url;
  };

  const valid = people.filter(isValid);
  const namesOnly = people.filter(p => isLikelyPersonName(p.full_name));

  let detection_reason = '';
  let source_quality = 0;

  const hasJsonLd = people.some(p => p._evidence?.includes('jsonld'));
  if (hasJsonLd) source_quality = Math.max(source_quality, 2);

  // A) Sterk bewijs: >=2 personen met naam + (rol/contact/foto)
  if (valid.length >= 2) {
    detection_reason = '>=2 personen met naam + (rol of contact/link)';
    source_quality = Math.max(source_quality, 2 + (hasJsonLd ? 1 : 0)); // 2..3
    return { source_quality, detection_reason, validPeople: valid };
  }

  // B) 1-persoon-bedrijf met >=2 signalen
  if (valid.length === 1) {
    const p = valid[0];
    const signals = [!!p.role_title, !!p.linkedin_url, !!p.photo_url, !!p.email, !!p.phone].filter(Boolean).length;
    if (signals >= 2) {
      detection_reason = '1 persoon met ≥2 sterke signalen (rol/email/phone/linkedin/foto)';
      source_quality = Math.max(source_quality, 2 + (hasJsonLd ? 1 : 0)); // 2..3
      return { source_quality, detection_reason, validPeople: [p] };
    }
    // val door naar alternatieve regel
  }

  // C) Context-regel: team/about + >=2 geldige namen (ook zonder extra signalen)
  if (ctxLooksLikeTeam && namesOnly.length >= 2) {
    detection_reason = '>=2 namen op team/about pagina (zonder extra signalen)';
    source_quality = Math.max(source_quality, 1); // lager, maar voldoende om te accepteren
    return { source_quality, detection_reason, validPeople: namesOnly };
  }

  // Geen accept
  detection_reason = valid.length === 1
    ? 'Onvoldoende bewijs voor 1-persoon-bedrijf'
    : 'Geen valide personen gevonden';

  if (ctxLooksLikeTeam) source_quality = Math.min(3, source_quality + 1);
  return { source_quality, detection_reason, validPeople: [] };
}


/* ======================================
   4) Publieke API: scrapePeopleForDomain
   ====================================== */
export async function scrapePeopleForDomain(companyDomain) {
  const root = `https://${companyDomain.replace(/\/+$/,'')}`;
  const candidates = [...CANDIDATE_PATHS.map(p => toAbs(root, p))].filter(Boolean);

  // homepage → extra kandidaten opsnorren
  try {
    const { html } = await fetchHtml(root);
    const $ = cheerio.load(html);
    const anchors = $('a[href]').map((_,a)=>$(a).attr('href')).get()
      .map(h => toAbs(root, h))
      .filter(Boolean);
    const extra = anchors.filter(u => /team|over-?ons|about|who-we-are|organisatie|management|bestuur|leadership|board/i.test(u || ''));
    for (const u of extra.slice(0,5)) if (!candidates.includes(u)) candidates.push(u);
  } catch { /* homepage mag falen */ }

  let best = null;

  for (const url of candidates.slice(0, 12)) {
    try {
      const { html, res } = await fetchHtml(url);
      const $ = cheerio.load(html);

      const title = $('title').text();
      const h1 = $('h1').first().text();
      const pageCtx = `${title} | ${h1}`.trim();
      // ✅ Blocked/WAF/ratelimit?
const blockedStatuses = new Set([401, 403, 429, 503]);
if (blockedStatuses.has(res.status)) {
  const team_page_hash = crypto.createHash('sha256').update(html).digest('hex');
  best = best ?? {
    accept: false,
    url,
    reason: 'blocked',
    source_quality: 0,
    team_page_hash,
    etag: res.headers.get('etag'),
    last_modified: res.headers.get('last-modified'),
    evidence_urls: [url] // altijd bewijs bewaren
  };
  continue;
}


      if (pageLooksLike404OrNoise(title, h1, res.status)) {
  const team_page_hash = crypto.createHash('sha256').update(html).digest('hex');
  best = best ?? {
  accept: false,
  url,
  reason: 'page-404-or-noise',
  source_quality: 0,
  team_page_hash: crypto.createHash('sha256').update(html).digest('hex'),
  etag: res.headers.get('etag'),
  last_modified: res.headers.get('last-modified'),
  evidence_urls: [url]
};
  continue;
}


      const rawPeople = extractPeople($, url);

      // Dedup: full_name + (linkedin/email/phone/foto)
      const uniq = [];
      const seen = new Set();
      for (const p of rawPeople) {
        const key = [
          normName(p.full_name),
          p.linkedin_url || p.email || p.phone || p.photo_url || ''
        ].join('|');
        if (!normName(p.full_name)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(p);
      }

      const { source_quality, detection_reason, validPeople } = scoreAndReason(uniq, pageCtx);

      const accept =
        validPeople.length >= 2 ||
        (validPeople.length === 1 && /1 persoon/.test(detection_reason));

      if (!accept) {
 best = best ?? {
  accept: false,
  url,
  reason: detection_reason,
  source_quality,
  team_page_hash: crypto.createHash('sha256').update(html).digest('hex'),
  etag: res.headers.get('etag'),
  last_modified: res.headers.get('last-modified'),
  evidence_urls: [url]
};

  continue;
}


      const people = validPeople.map(p => ({
        full_name: p.full_name,
        role_title: p.role_title || null,
        email: p.email || null,
        phone: p.phone || null,
        linkedin_url: p.linkedin_url || null,
        photo_url: p.photo_url || null,
      }));

      const result = {
        accept: true,
        people,
        people_count: people.length,
        team_page_url: url,
        evidence_urls: [url],
        detection_reason,
        source_quality,
        team_page_hash: crypto.createHash('sha256').update(html).digest('hex'),
        etag: res.headers.get('etag'),
        last_modified: res.headers.get('last-modified')
      };

      // kies beste
      if (!best || (best.source_quality ?? 0) < source_quality) best = result;
      if (result.source_quality === 3) break; // early exit bij hoge kwaliteit

    } catch (e) {
  best = best ?? {
    accept: false,
    url,
    reason: `error:${e.message}`,
    evidence_urls: [url] // ✅ bewijs ook bij errors
  };
}

  }

  if (!best) {
    return { accept: false, reason: 'no-candidates' };
  }
  return best;
}
