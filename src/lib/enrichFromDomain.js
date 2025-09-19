import fetch from "node-fetch";
import { chooseBestLocation } from "./googleMapsUtils.js";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// v1: hulpjes om velden veilig te lezen
function getLocalizedText(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  return x.text ?? null;
}

function toTextQuery(q) {
  // Zet "https://www.moreketing.nl/..." → "moreketing"
  let s = String(q || '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const host = s.split(/[/?#]/)[0]; // pak alleen host
  if (/\./.test(host)) {
    const base = host.split('.')[0].replace(/[-_]/g, ' ').trim();
    if (base) return base;
  }
  return s;
}


function extractStructuredAddressV1(addressComponents = []) {
  // v1 heeft addressComponents: [{ longText, shortText, types: [...] }, ...]
  const pick = (type) => addressComponents.find(c => Array.isArray(c.types) && c.types.includes(type));

  const streetNumber = getLocalizedText(pick('street_number')?.longText);
  const route        = getLocalizedText(pick('route')?.longText);
  const postal       = getLocalizedText(pick('postal_code')?.longText);
  const city         =
      getLocalizedText(pick('locality')?.longText)
   || getLocalizedText(pick('postal_town')?.longText)
   || getLocalizedText(pick('administrative_area_level_2')?.longText)
   || null;

  const countryObj   = pick('country');
  const countryLong  = getLocalizedText(countryObj?.longText) || null;
  const countryShort = getLocalizedText(countryObj?.shortText) || null; // NL/BE/…

  // domain_address: “Straat 12” of fallback naar formattedAddress (doen we later)
  const domain_address = (route || streetNumber)
    ? [route, streetNumber].filter(Boolean).join(' ')
    : null;

  return {
    domain_address,
    domain_postal_code: postal || null,
    domain_city: city || null,
    domain_country: countryLong || null,
    domain_country_code: countryShort || null,
  };
}

export async function enrichFromDomain(queryString, ipLat, ipLon) {
  try {
    if (!queryString) return null;

    // 1) SEARCH (v1) – Nederlands
    const searchUrl = 'https://places.googleapis.com/v1/places:searchText';
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      // we willen id + basis velden uit search; details halen we per id
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.primaryType',
        'places.primaryTypeDisplayName',
        'places.formattedAddress',
        'places.location',
        'places.websiteUri',
        'places.types'
      ].join(',')
    };
    const body = {
textQuery: toTextQuery(queryString),
      languageCode: 'nl',
      regionCode: 'NL'
    };

    const searchRes = await fetch(searchUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const searchCT  = searchRes.headers.get('content-type') || '';
    if (!searchRes.ok || !searchCT.includes('application/json')) {
      const txt = await searchRes.text().catch(() => '');
      console.error('❌ places:searchText bad response:', searchRes.status, txt.slice(0, 300));
      return null;
    }
    const searchJson = await searchRes.json();
    const places = Array.isArray(searchJson?.places) ? searchJson.places.slice(0, 5) : [];
    if (places.length === 0) return null;

    // 2) DETAILS (v1) – per kandidaat, voor telefoon + addressComponents (NL)
    const detailFieldMask = [
      'id',
      'displayName',
      'primaryType',
      'primaryTypeDisplayName',
      'types',
      'formattedAddress',
      'websiteUri',
      'location',
      'internationalPhoneNumber',
      'nationalPhoneNumber',
      'addressComponents'
    ].join(',');

    const enriched = [];
    for (const p of places) {
      const id = p.id;
      // GET https://places.googleapis.com/v1/places/{id}
      const detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=nl&regionCode=NL`;
      const detailsRes = await fetch(detailsUrl, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': detailFieldMask
        }
      });
      const detCT = detailsRes.headers.get('content-type') || '';
      if (!detailsRes.ok || !detCT.includes('application/json')) {
        const txt = await detailsRes.text().catch(() => '');
        console.warn('⚠️ places/{id} bad response:', detailsRes.status, txt.slice(0, 250));
        continue;
      }
      const d = await detailsRes.json();

      const displayName = getLocalizedText(d.displayName) || getLocalizedText(p.displayName) || null;
      const primaryType = d.primaryType || p.primaryType || null;
      const primaryTypeDisplayName = getLocalizedText(d.primaryTypeDisplayName) || getLocalizedText(p.primaryTypeDisplayName) || null;

      const formattedAddress = d.formattedAddress || p.formattedAddress || null;
      const websiteUri       = d.websiteUri || p.websiteUri || null;
      const location         = d.location || p.location || null; // { latitude, longitude }
      const lat = location?.latitude ?? null;
      const lon = location?.longitude ?? null;

      const addrStruct = extractStructuredAddressV1(d.addressComponents || []);
      // Vul domain_address met fallback naar formattedAddress als straat+nummer ontbreken
      const domain_address = addrStruct.domain_address || formattedAddress || null;

      enriched.push({
        name: displayName,
        address: formattedAddress,
        phone: d.internationalPhoneNumber || d.nationalPhoneNumber || null,
        website: websiteUri,
        // ✨ Belangrijk: ruwe machine-key én NL weergave
        category: primaryType || null,               // bv. "internet_marketing_service"
        category_nl: primaryTypeDisplayName || null, // bv. "Internetmarketingbureau" (NL uit Google)
        place_types: Array.isArray(d.types) ? d.types : (Array.isArray(p.types) ? p.types : []),
        lat,
        lon,
        // structured:
        ...addrStruct,
        domain_address
      });
    }

    if (enriched.length === 0) {
      console.warn("⚠️ Geen verrijkte locaties beschikbaar (v1 details).");
      return null;
    }

    // 3) Zelfde keuze-logica als bij jou
    if (typeof ipLat !== 'number' || typeof ipLon !== 'number') {
      const first = enriched[0];
      return {
        ...first,
        confidence: 0.5,
        confidence_reason: "no-ip-location",
        selected_random_match: false
      };
    }

    const { match, confidence, reason, selected_random_match } =
      chooseBestLocation(enriched, ipLat, ipLon, queryString);

    return {
      ...match,
      confidence,
      confidence_reason: reason,
      selected_random_match: !!selected_random_match
    };
  } catch (err) {
    console.error("❌ Fout in enrichFromDomain(v1):", err?.message || err);
    return null;
  }
}
