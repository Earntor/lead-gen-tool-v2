export default async function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'lead-gen-tool-v2 (contact: your-email@example.com)',
        'Accept': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!r.ok) return res.status(r.status).json({ error: `Upstream ${r.status}` });

    const ctype = r.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) return res.status(502).json({ error: 'Upstream returned non-JSON' });

    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ lat: first.lat, lon: first.lon });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ lat: null, lon: null });
  } catch (e) {
    const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
    return res.status(isAbort ? 504 : 500).json({ error: isAbort ? 'Timeout' : (e?.message || 'Server error') });
  }
}
