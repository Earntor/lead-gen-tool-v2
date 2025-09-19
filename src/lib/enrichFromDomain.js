import fetch from "node-fetch";
import { chooseBestLocation } from "./googleMapsUtils.js";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const GENERIC_TYPES = new Set([
  'establishment', 'point_of_interest', 'premise', 'store', 'finance',
  'health', 'food', 'lodging', 'school', 'university'
]);

function formatCategory(key) {
  if (!key) return null;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickCategory(types = []) {
  const specific = types.find(t => !GENERIC_TYPES.has(t));
  return formatCategory(specific || types[0] || null);
}

function pickAddrObj(comp, type) {
  return comp?.find(c => c.types?.includes(type)) || null;
}

function extractStructuredAddress(result) {
  const comp = result.address_components || [];

  const streetNumber = pickAddrObj(comp, 'street_number')?.long_name || null;
  const route        = pickAddrObj(comp, 'route')?.long_name || null;
  const postal       = pickAddrObj(comp, 'postal_code')?.long_name || null;
  const city         = pickAddrObj(comp, 'locality')?.long_name
                    || pickAddrObj(comp, 'postal_town')?.long_name
                    || pickAddrObj(comp, 'administrative_area_level_2')?.long_name
                    || null;
  const countryObj   = pickAddrObj(comp, 'country');
  const countryLong  = countryObj?.long_name || null;
  const countryShort = countryObj?.short_name || null; // ISO code (NL/BE/…)

  const formattedAddress = result.formatted_address || null;
  const domain_address = (route || streetNumber)
    ? [route, streetNumber].filter(Boolean).join(' ')
    : (formattedAddress || null);

  return {
    domain_address,
    domain_postal_code: postal || null,
    domain_city: city || null,
    domain_country: countryLong || null,
    domain_country_code: countryShort || null
  };
}

export async function enrichFromDomain(queryString, ipLat, ipLon) {
  try {
    if (!queryString) return null;

    // 👉 TERUG naar Text Search v0.5 (werkt met jouw key)
    const textSearchUrl =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(queryString)}` +
      `&language=nl&region=NL` +
      `&key=${GOOGLE_API_KEY}`;

    const textSearchRes = await fetch(textSearchUrl);
    const contentType = textSearchRes.headers.get("content-type");
    if (!textSearchRes.ok || !contentType?.includes("application/json")) {
      const fallbackText = await textSearchRes.text().catch(() => "");
      console.error("❌ Google TextSearch API gaf geen JSON terug:", fallbackText.slice(0, 300));
      return null;
    }

    const textSearchData = await textSearchRes.json();
    if (!textSearchData.results || textSearchData.results.length === 0) {
      return null;
    }

    const rawResults = textSearchData.results.slice(0, 5);
    const enriched = [];

    for (const r of rawResults) {
      const placeDetailsUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${r.place_id}` +
        `&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,types,address_components,geometry` +
        `&language=nl&region=NL` +
        `&key=${GOOGLE_API_KEY}`;

      const placeDetailsRes = await fetch(placeDetailsUrl);
      const detailsContentType = placeDetailsRes.headers.get("content-type");
      if (!placeDetailsRes.ok || !detailsContentType?.includes("application/json")) {
        const detailsText = await placeDetailsRes.text().catch(() => "");
        console.error("❌ Place Details gaf geen JSON terug:", detailsText.slice(0, 300));
        continue;
      }

      const placeDetailsData = await placeDetailsRes.json();
      const result = placeDetailsData.result;
      if (!result) continue;

      const name = result.name || null;
      const types = result.types || [];
      const category = pickCategory(types);

      const addr = extractStructuredAddress(result);
      const phone = result.international_phone_number || result.formatted_phone_number || null;
      const website = result.website || null;

      const lat = r.geometry?.location?.lat ?? result.geometry?.location?.lat ?? null;
      const lon = r.geometry?.location?.lng ?? result.geometry?.location?.lng ?? null;

      enriched.push({
        name,
        address: result.formatted_address || null,
        phone,
        website,
        category,              // 👈 blijft zoals je UI verwacht
        lat,
        lon,
        ...addr
      });
    }

    if (enriched.length === 0) return null;

    // Zelfde keuze-logica als bij jou
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
    console.error("❌ Fout in enrichFromDomain():", err?.message || err);
    return null;
  }
}
