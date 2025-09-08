/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      // 1) Zorg dat tracker.js nooit uit cache komt (altijd de nieuwste)
      {
        source: "/tracker.js",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },

      // (optioneel, maar mag): voorkom caching op de ingest/token en track API
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },

      // 2) JOUW bestaande CSP voor alle routes
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://www.google.com https://recaptcha.google.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
