import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * M-Pesa end to end, in mock mode (MPESA_ENV=mock): the server pretends to be
 * Safaricom and POSTs a real-shaped callback to /api/mpesa/callback/<secret>,
 * so the route, Zod, the idempotent SQL and the pages all run for real.
 * The customer's phone picks the outcome: ending 1032 = cancelled.
 */
test.describe.configure({ mode: "serial" });

const ownerFor = (project: string) => (project === "mobile" ? "cleaner" : "general");
const guestBusinessFor = (project: string) =>
  project === "mobile"
    ? { slug: "demo-mechanic", service: /Brake pads/ }
    : { slug: "demo-salon", service: /Box braids/ };
const INVOICE_URL = /\/dashboard\/invoices\/[0-9a-f-]{36}$/;
/** A fresh Kenyan mobile whose last digits are chosen (they drive the mock outcome). */
const phoneEnding = (suffix: string) =>
  `07${String(Math.floor(Math.random() * 1e8))
    .padStart(8, "0")
    .slice(0, 8 - suffix.length)}${suffix}`;
// The mock callback lands ~1.5 s after the request; pages poll every 2.5 s.
const SETTLE = { timeout: 20_000 };

async function choose(radio: Locator) {
  await radio.locator("xpath=..").click();
  await expect(radio).toBeChecked();
}

async function createIssuedInvoice(page: Page, owner: string, phone: string) {
  await signIn(page, `owner+${owner}@nextto.test`, "/dashboard/invoices/new");
  await page.getByLabel("Phone").fill(phone);
  await page
    .getByLabel("Name", { exact: true })
    .fill(`M-Pesa Guest ${Math.random().toString(36).slice(2, 7)}`);
  await page.getByLabel("Item 1 description").fill("Service");
  await page.getByLabel("Qty").first().fill("1");
  await page.getByLabel("Unit price (KES)").first().fill("1500");
  await page.getByLabel("VAT").selectOption("0");
  await page.getByRole("button", { name: "Save draft invoice" }).click();
  await expect(page).toHaveURL(INVOICE_URL);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByTestId("doc-balance")).toHaveText(/1,500/);
}

test("staff send an M-Pesa request from an invoice and it gets paid", async ({
  page,
}, testInfo) => {
  test.slow();
  await createIssuedInvoice(page, ownerFor(testInfo.project.name), phoneEnding("55"));

  const form = page.getByRole("form", { name: "Request an M-Pesa payment" });
  await expect(form.getByLabel("Amount (KES)")).toHaveValue("1500");
  await form.getByRole("button", { name: "Send M-Pesa request" }).click();

  await expect(page.getByText(/Invoice · Paid/)).toBeVisible(SETTLE);
  await expect(page.getByText(/NXT[A-Z2-9]{7}/).first()).toBeVisible();
  await expect(page.getByTestId("doc-balance")).toHaveText(/^Ksh\s*0(\.00)?$/);
});

test("a customer cancels the prompt from a shared invoice, then can retry", async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  await createIssuedInvoice(page, ownerFor(testInfo.project.name), phoneEnding("1032"));
  const shareUrl = (await page.getByTestId("share-url").textContent())!.trim();

  const guest = await browser.newContext();
  const shared = await guest.newPage();
  await shared.goto(shareUrl);
  await shared.getByRole("button", { name: /Pay Ksh\s*1,500 with M-Pesa/ }).click();
  await expect(shared.getByText("The last M-Pesa prompt was cancelled.")).toBeVisible(SETTLE);
  // Still unpaid, and the button is back for another try.
  await expect(shared.getByRole("button", { name: /with M-Pesa/ })).toBeVisible();
  await expect(shared.getByTestId("doc-balance")).toHaveText(/1,500/);
  await guest.close();
});

test("a guest pays a booking deposit and the booking is confirmed", async ({ page }, testInfo) => {
  test.slow();
  const { slug, service } = guestBusinessFor(testInfo.project.name);
  await page.goto(`/b/${slug}`);
  await choose(page.getByRole("radio", { name: service }));

  const days = page.getByRole("radiogroup", { name: "Day" }).getByRole("radio");
  const times = page.getByRole("radiogroup", { name: /^Times on/ }).getByRole("radio");
  let found = false;
  for (let i = 1 + Math.floor(Math.random() * 6); i < (await days.count()) && !found; i++) {
    await choose(days.nth(i));
    await expect(page.getByText(/Finding free times/)).toBeHidden();
    found = (await times.count()) > 0;
  }
  expect(found, "some day has a free time").toBe(true);
  await choose(times.first());

  await page.getByLabel("Full name").fill("Akinyi Odhiambo");
  await page.getByLabel("Phone (M-Pesa)").fill(phoneEnding("77"));
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Almost there, Akinyi/);
  await page.getByRole("button", { name: /Pay Ksh\s*[\d,]+ deposit with M-Pesa/ }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /You're booked, Akinyi!/,
    SETTLE,
  );
  await expect(page.getByTestId("mpesa-receipt")).toHaveText(/^NXT[A-Z2-9]{7}$/);
});

test("the callback route hides itself behind the secret", async ({ request }) => {
  const wrong = await request.post("/api/mpesa/callback/not-the-secret", { data: {} });
  expect(wrong.status()).toBe(404);
});
