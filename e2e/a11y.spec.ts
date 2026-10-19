import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNoSideScroll, signIn } from "./helpers";

/**
 * Automated accessibility and layout sweep: every main page at phone, tablet
 * and desktop widths, in light and dark themes, checked with axe-core against
 * WCAG 2.1 A/AA and for sideways scrolling. axe can't judge everything (focus
 * order, wording), but it reliably catches contrast, labels, landmarks and ARIA
 * mistakes.
 */

const WIDTHS = [360, 768, 1440] as const;
const SCHEMES = ["light", "dark"] as const;

const PUBLIC_PAGES = ["/", "/login", "/b/demo-salon"];
const DASHBOARD_PAGES = [
  "/dashboard",
  "/dashboard/calendar?view=day",
  "/dashboard/calendar?view=week",
  "/dashboard/customers",
  "/dashboard/invoices",
  "/dashboard/invoices/new",
  "/dashboard/bookings/new",
  "/dashboard/reports",
];

async function sweep(page: Page, paths: string[]) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      for (const path of paths) {
        const where = `${path} at ${width}px, ${colorScheme}`;
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first(), where).toBeVisible();
        await expect(page, where).toHaveTitle(/Nextto/);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        // Soft, so one run reports every problem rather than the first.
        expect
          .soft(
            violations.map(
              (v) =>
                `${v.id} (${v.impact}): ${v.nodes
                  .slice(0, 3)
                  .map((n) => n.target.join(" "))
                  .join(" | ")}`,
            ),
            where,
          )
          .toEqual([]);
        if (width === 360) await expectNoSideScroll(page);
      }
    }
  }
}

test("public pages are accessible in both themes at every width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewports are set explicitly; run once");
  test.slow();
  await sweep(page, PUBLIC_PAGES);
});

test("dashboard pages are accessible in both themes at every width", async ({ page }, testInfo) => {
  // The salon owner signs in from reports.spec.ts on desktop; use it here on
  // mobile only, so the two never race for the same magic link.
  test.skip(testInfo.project.name !== "mobile", "one sign-in per seeded owner");
  test.slow();
  await signIn(page, "owner+salon@nextto.test", "/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await sweep(page, DASHBOARD_PAGES);
});
