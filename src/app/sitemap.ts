import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";

// Rendered per request, not at build time: the build (in CI and on Vercel)
// shouldn't need a database. Crawlers fetch it rarely, and it is one RPC.
export const dynamic = "force-dynamic";

/** /sitemap.xml: the landing page plus every business that has something to book. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;
  const { data, error } = await createAnonClient().rpc("public_booking_pages");
  if (error) throw error;
  return [
    { url: new URL("/", site).toString(), changeFrequency: "monthly", priority: 1 },
    ...data.map((p) => ({
      url: new URL(`/b/${p.slug}`, site).toString(),
      lastModified: new Date(p.last_modified),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
