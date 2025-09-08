/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      // 1) tracker.js nooit uit cache halen (altijd de nieuwste versie laden)
      {
        source: "/tracker.js",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },

      // 2) API-calls ook nooit cachen (optioneel, maar handig voor debugging)
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },

      // 3) Jouw bestaande CSP voor alle routes
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
