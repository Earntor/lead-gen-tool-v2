import { supabaseAdmin } from './supabaseAdminClient'

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

export async function enrichFromMaps(ip) {
  // Check of IP al verrijkt is
  const { data: existing } = await supabaseAdmin
    .from('ip_enrichment_cache')
    .select('*')
    .eq('ip', ip)
    .single()

  if (existing) {
    console.log('🔁 IP al verrijkt via Maps')
    return existing
  }

  // Haal locatie uit ipapi_cache
  const { data: cached } = await supabaseAdmin
    .from('ipapi_cache')
    .select('ip_address, lat, lon')
    .eq('ip_address', ip)
    .single()

  if (!cached || !cached.lat || !cached.lon) {
    console.warn('⚠️ Geen lat/lon voor IP', ip)
    return null
  }

  const { lat, lon } = cached
  const radius = 350
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${radius}&key=${GOOGLE_MAPS_API_KEY}`

  const mapsRes = await fetch(url)
  const mapsData = await mapsRes.json()
  mapsData.results.forEach(p =>
  console.log('📦 Mogelijk bedrijf:', p.name, p.types)
)

console.log('🔍 Maps API ruwe output:', JSON.stringify(mapsData, null, 2))
console.log('📍 Lat/lon gebruikt voor Maps:', lat, lon)
console.log('🌐 Maps request URL:', url)

// 👉 Toon alle gevonden bedrijven (ook als ze niet door je filter komen)
mapsData.results.forEach(p => {
  console.log('📦 Mogelijk bedrijf:', p.name, p.types)
})


  if (!mapsData.results || mapsData.results.length === 0) {
    console.log('❌ Geen bedrijven gevonden via Maps')
    return null
  }

  const place = mapsData.results.find(p =>
    p.types?.includes('establishment') || p.types?.includes('point_of_interest')
  )

  if (!place) {
    console.log('⚠️ Geen geschikt bedrijf gevonden via Maps')
    return null
  }

    const record = {
    ip,
    lat,
    lon,
    radius,
    geohash: null,
    maps_result: place,
    confidence: 0.6,
    enriched_at: new Date().toISOString()  // ✅ juist
  }


  const { error: insertError } = await supabaseAdmin
    .from('ip_enrichment_cache')
    .insert(record)

  if (insertError) {
    console.error('❌ Fout bij opslaan enrichment:', insertError)
    return null
  }

  return record
}
