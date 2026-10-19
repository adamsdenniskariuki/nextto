import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

/**
 * /robots.txt. Only the landing page and public booking pages are meant for
 * search engines. Vercel preview deployments (VERCEL_ENV=preview) ask crawlers
 * to stay away entirely, so test data never ends up in search results.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV === "preview") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/b/"],
      disallow: ["/dashboard", "/onboarding", "/invite/", "/login", "/auth/", "/api/", "/i/"],
    },
    sitemap: new URL("/sitemap.xml", publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
