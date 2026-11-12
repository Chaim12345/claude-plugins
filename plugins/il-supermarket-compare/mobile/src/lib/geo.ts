// Choosing among geocoder answers. Pure functions with no imports, tested with node --test.

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dp = (lat2 - lat1) * r, dl = (lon2 - lon1) * r;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2));
}

export type LatLon = { lat: number; lon: number };

/** The city part of a typed address: the text after its last comma ("הרצל 10, חיפה" -> "חיפה"). */
export function typedCity(address: string): string | null {
  const parts = address.split(/[,،]/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

/** How far from a city's centre a result in that city can be (Jerusalem spans ~10 km). */
export const MAX_FROM_CENTRE_KM = 10;

/**
 * The first candidate in the typed city. The city is checked by distance from its centre rather
 * than by name, because the phone's geocoder answers in the phone's language ("Haifa", not "חיפה").
 * Without a known centre there's nothing to check against, so the first candidate wins.
 */
export function chooseCandidate(cands: LatLon[], centre: LatLon | null, maxKm = MAX_FROM_CENTRE_KM): LatLon | null {
  if (!cands.length) return null;
  if (!centre) return cands[0];
  return cands.find(c => km(c.lat, c.lon, centre.lat, centre.lon) <= maxKm) ?? null;
}
