// middleware.js
import { NextResponse } from 'next/server';

const BOT_UA = [
  'bot','spider','crawl','slurp','bingpreview',
  'googlebot','applebot','baiduspider','yandex','duckduckbot',
  'vercel-screenshot-bot','vercel-favicon-bot'
];

function isBot(ua) {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return BOT_UA.some(k => s.includes(k));
}

export function middleware(req) {
  const { pathname } = new URL(req.url);
  const ua = req.headers.get('user-agent') || '';

  // Alleen onze tracking-assets en -endpoints beschermen
  const isProtected =
    pathname === '/api/track' ||
    pathname === '/api/ingest-token' ||
    pathname === '/tracker.js';

  if (!isProtected) return NextResponse.next();

  // Bots: direct 204 (geen body, geen downstream compute/DB)
  if (isBot(ua)) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.next();
}

// Zorg dat middleware alléén op deze paden draait
export const config = {
  matcher: ['/api/track', '/api/ingest-token', '/tracker.js']
};
