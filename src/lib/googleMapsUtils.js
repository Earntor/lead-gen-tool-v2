export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meter
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function chooseBestLocation(locations, ipLat, ipLon, domain) {
  const matches = locations.map((loc) => ({
    ...loc,
    distance: getDistanceMeters(ipLat, ipLon, loc.lat, loc.lon),
    hasDomain: loc.website?.includes(domain),
  }));

  const domainMatch = matches.find((m) => m.hasDomain);
  if (domainMatch) {
    return {
      match: domainMatch,
      confidence: 0.95,
      reason: "domain-match",
      selected_random_match: false,
    };
  }

  const within2km = matches.filter((m) => m.distance < 2000);
  if (within2km.length > 1) {
    const random = within2km[Math.floor(Math.random() * within2km.length)];
    return {
      match: random,
      confidence: 0.6,
      reason: "multiple-close-random",
      selected_random_match: true,
    };
  }

  const closest = matches.sort((a, b) => a.distance - b.distance)[0];
  return {
    match: closest,
    confidence: 0.75,
    reason: "closest-location",
    selected_random_match: false,
  };
}
