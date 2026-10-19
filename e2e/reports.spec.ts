import { expect, test } from "@playwright/test";
import { expectNoSideScroll, signIn } from "./helpers";

// The seeded salon owner (past paid bookings, see supabase/seed.sql) is used by
// this file only. A new magic link replaces the old one, so sign in once, from one
// project; the last step resizes to a 360px phone instead of a second sign-in.
const OWNER = "owner+salon@nextto.test";

test("owner reads reports, switches the period, and it fits a phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one sign-in per seeded owner");
  await signIn(page, OWNER, "/dashboard/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();

  const period = page.getByRole("navigation", { name: "Period" });
  await expect(period.getByRole("link", { name: "30 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("kpi-revenue")).toHaveText(/^Ksh\s[1-9][\d,]*$/);
  await expect(page.getByTestId("kpi-outstanding")).toHaveText(/^Ksh\s[\d,]+$/);

  for (const name of [
    "Revenue trend",
    "Busiest hours",
    "Staff utilisation",
    "Receivables ageing",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole("img", { name: /Revenue per day/ })).toBeVisible();
  await expect(page.getByRole("meter").first()).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "90+ days" })).toBeVisible();

  // A year is too many bars for daily buckets, so the chart switches to weeks.
  await period.getByRole("link", { name: "12 months" }).click();
  await expect(page).toHaveURL(/range=365d/);
  await expect(period.getByRole("link", { name: "12 months" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("img", { name: /Revenue per week/ })).toBeVisible();

  await page.getByText("Show the numbers").click();
  await expect(page.getByRole("columnheader", { name: "Revenue" }).first()).toBeVisible();

  // Nonsense in the URL falls back to the default rather than erroring.
  await page.goto("/dashboard/reports?range=constructor");
  await expect(period.getByRole("link", { name: "30 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/dashboard/reports?range=90d");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByRole("link", { name: "See unpaid invoices" }).click();
  await expect(page).toHaveURL(/\/dashboard\/invoices\?show=unpaid/);
});
