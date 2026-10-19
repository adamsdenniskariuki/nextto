import { expect, test } from "@playwright/test";

/** Platform files: 404, robots, sitemap, manifest, icons and security headers. */
test.describe("site shell", () => {
  test.skip(({ isMobile }) => isMobile, "Covered once on desktop");

  test("unknown URLs render the branded 404 with the right status", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /nextto/i }).first()).toBeVisible();
  });

  test("robots.txt keeps crawlers out of private areas and points at the sitemap", async ({
    request,
  }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("sitemap.xml lists public booking pages", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("/b/demo-salon");
  });

  test("manifest, icons and the social card are served", async ({ request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      short_name: string;
    };
    expect(manifest.short_name).toBe("Nextto");
    for (const path of ["/icon.svg", "/apple-icon", "/opengraph-image"]) {
      expect((await request.get(path)).ok(), path).toBe(true);
    }
  });

  test("responses carry security headers", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("the secondary domain redirects to nextto.app", async ({ request }) => {
    const res = await request.get("/b/demo-salon", {
      headers: { host: "nextto.madebyfavor.com" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("https://nextto.app/b/demo-salon");
  });
});
