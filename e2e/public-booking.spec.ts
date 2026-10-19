import { expect, test, type Locator } from "@playwright/test";

/**
 * Radios here are visually hidden inside card-like <label>s, so click the
 * label the way a person would, then assert the radio really got checked.
 */
async function choose(radio: Locator) {
  await radio.locator("xpath=..").click();
  await expect(radio).toBeChecked();
}

// Seeded by supabase/seed.sql: one demo business per preset.
const SLUG = "demo-salon";

test("an unknown business shows a friendly 404", async ({ page }) => {
  const res = await page.goto("/b/no-such-business-here");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});

test("the booking page is server-rendered for search engines", async ({ request }) => {
  // A raw HTTP fetch (no JavaScript) must already contain the content.
  const res = await request.get(`/b/${SLUG}`);
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toMatch(/<title>Book with [^<]+ · Nextto<\/title>/);
  expect(html).toContain('<link rel="canonical"');
  expect(html).toContain('"@type":"LocalBusiness"');
  expect(html).toContain("Price list");
});

test("a guest books a time and gets a confirmation", async ({ page }, testInfo) => {
  await page.goto(`/b/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await choose(page.getByRole("radio").first());

  // Each Playwright project starts on a different day so parallel runs
  // don't compete for the same slot. Skip days with no free times (e.g. Sunday).
  const days = page.getByRole("radiogroup", { name: "Day" }).getByRole("radio");
  const offset = testInfo.project.name === "mobile" ? 2 : 5;
  const times = page.getByRole("radiogroup", { name: /^Times on/ }).getByRole("radio");
  let found = false;
  for (let i = offset; i < (await days.count()) && !found; i++) {
    await choose(days.nth(i));
    await expect(page.getByText(/Finding free times/)).toBeHidden();
    found = (await times.count()) > 0;
  }
  expect(found, "some day in the next two weeks has a free time").toBe(true);

  const time = (await times.first().locator("..").textContent())?.trim();
  await choose(times.first());

  await page.getByLabel("Full name").fill("Wanjiru Kamau");
  // A fresh number: book_public reuses (and never renames) a customer with a known phone.
  const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  await page.getByLabel("Phone (M-Pesa)").fill(phone);
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page).toHaveURL(/\/b\/demo-salon\/confirmed\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /You're booked, Wanjiru!|Almost there, Wanjiru/,
  );
  await expect(page.getByText(/Reference [0-9A-F]{8}/)).toBeVisible();
  await expect(page.getByText(`at ${time}`)).toBeVisible();

  // The "Add to calendar" link serves a real iCalendar file.
  const href = await page.getByRole("link", { name: "Add to calendar" }).getAttribute("href");
  const ics = await page.request.get(href!);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain("BEGIN:VEVENT");
});

test("the guest form explains invalid input", async ({ page }) => {
  await page.goto(`/b/${SLUG}`);
  await choose(page.getByRole("radio").first());
  const days = page.getByRole("radiogroup", { name: "Day" }).getByRole("radio");
  const times = page.getByRole("radiogroup", { name: /^Times on/ }).getByRole("radio");
  for (let i = 8; i < (await days.count()); i++) {
    await choose(days.nth(i));
    await expect(page.getByText(/Finding free times/)).toBeHidden();
    if ((await times.count()) > 0) break;
  }
  await choose(times.first());
  await page.getByLabel("Full name").fill("Otieno");
  await page.getByLabel("Phone (M-Pesa)").fill("12345");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.getByText("Enter a phone number like 0712 345 678")).toBeVisible();
  // What the guest typed survives the round trip.
  await expect(page.getByLabel("Full name")).toHaveValue("Otieno");
});
