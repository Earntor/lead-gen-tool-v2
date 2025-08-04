import fetch from 'node-fetch';
import crypto from 'crypto';

/**
 * Haalt de favicon op van een IP-adres en berekent de SHA-256 hash
 * @param {string} ip
 * @returns {string|null} de hex-hash of null als mislukt
 */
export async function getFaviconHash(ip) {
  try {
    const url = `http://${ip}/favicon.ico`;
    const res = await fetch(url, {
      timeout: 3000, // je kunt dit eventueel verlagen naar 1500
      headers: { 'User-Agent': 'LeadGenBot/1.0' },
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('image')) {
      console.warn(`⚠️ Geen geldige favicon voor ${ip}:`, res.status);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer(); // i.p.v. res.buffer()
    const buffer = Buffer.from(arrayBuffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    return hash;
  } catch (e) {
    if (e.code === 'ETIMEDOUT') {
      console.warn(`⚠️ Timeout bij favicon ophalen van ${ip}`);
    } else {
      console.warn(`⚠️ Favicon ophalen of hash berekenen faalde voor ${ip}:`, e.message);
    }
    return null;
  }
}
