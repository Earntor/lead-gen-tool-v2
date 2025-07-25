import fetch from "node-fetch";
import { chooseBestLocation } from "./googleMapsUtils.js";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Helper om categorie leesbaar te maken
function formatCategory(key) {
  if (!key) return null;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function enrichFromDomain(domain, ipLat, ipLon) {
  try {
    const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      domain
    )}&key=${GOOGLE_API_KEY}`;

    const textSearchRes = await fetch(textSearchUrl);
    const textSearchBody = await textSearchRes.text();

    let textSearchData;
    try {
      textSearchData = JSON.parse(textSearchBody);
    } catch (e) {
      console.error("❌ Kan Text Search response niet parsen als JSON:", textSearchBody.slice(0, 300));
      return null;
    }

    console.log("📦 Google TextSearch data:", JSON.stringify(textSearchData, null, 2));

    if (!textSearchData.results || textSearchData.results.length === 0) {
      console.warn("❌ Geen bedrijf gevonden via Text Search");
      return null;
    }

    const rawResults = textSearchData.results.slice(0, 5);
    const enrichedLocations = [];

    for (const r of rawResults) {
      const placeDetailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${
        r.place_id
      }&fields=name,formatted_address,formatted_phone_number,website,types&key=${GOOGLE_API_KEY}`;

      const placeDetailsRes = await fetch(placeDetailsUrl);
      const placeDetailsText = await placeDetailsRes.text();

      let placeDetailsData;
      try {
        placeDetailsData = JSON.parse(placeDetailsText);
      } catch (e) {
        console.error("❌ Kan Place Details response niet parsen als JSON:", placeDetailsText.slice(0, 300));
        continue;
      }

      const result = placeDetailsData.result;
      if (!result) continue;

      const name = result.name || null;
      const formatted_address = result.formatted_address || "";
      const phone = result.formatted_phone_number || null;
      const website = result.website || null;
      const types = result.types || [];
      const rawCategory = types[0] || null;
      const category = formatCategory(rawCategory);

      // 🇳🇱 🇧🇪 Adres parsing
      const addressRegex = /^(.+?),\s*(\d{4}\s?[A-Z]{2})\s(.+),\s*(.+)$/;
      const match = formatted_address.match(addressRegex);

      let adres = null;
      let postcode = null;
      let plaats = null;
      let land = null;

      if (match) {
        adres = match[1].trim();
        postcode = match[2].trim();
        plaats = match[3].trim();
        land = match[4].trim();
      } else {
        adres = formatted_address || null;
      }

      enrichedLocations.push({
        name,
        address: formatted_address || null,
        phone,
        website,
        category,
        lat: r.geometry.location.lat,
        lon: r.geometry.location.lng,
        domain_address: adres || null,
        domain_postal_code: postcode || null,
        domain_city: plaats || null,
        domain_country: land || null,
      });
    }

    if (enrichedLocations.length === 0) {
      console.warn("⚠️ Geen verrijkte locaties beschikbaar.");
      return null;
    }

    if (!ipLat || !ipLon) {
      console.warn("⚠️ IP-locatie onbekend — gebruik eerste match.");
      const first = enrichedLocations[0];
      return {
        ...first,
        confidence: 0.5,
        confidence_reason: "no-ip-location",
        selected_random_match: false,
      };
    }

    const {
      match,
      confidence,
      reason,
      selected_random_match,
    } = chooseBestLocation(enrichedLocations, ipLat, ipLon, domain);

    return {
      ...match,
      confidence,
      confidence_reason: reason,
      selected_random_match: selected_random_match || false,
    };
  } catch (err) {
    console.error("❌ Fout bij enrichFromDomain:", err.message);
    return null;
  }
}
