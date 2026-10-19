import type { NextConfig } from "next";

/**
 * Headers for every response. A full script CSP needs per-request nonces (and
 * gives up static rendering), so this sets the directives that are safe with
 * Next's inline scripts: no framing (clickjacking), no <base> or <object>
 * tricks, and forms may only post back to this site.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // The secondary domain forwards to the primary, keeping the path. Vercel's
      // domain settings can do this too (docs/SETUP.md §7); this is the fallback
      // if the domain is attached to the project without a redirect.
      {
        source: "/:path*",
        has: [{ type: "host", value: "nextto.madebyfavor.com" }],
        destination: "https://nextto.app/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
