import { expect, test, type Page } from "@playwright/test";
import { expectNoSideScroll, signIn } from "./helpers";

// One seeded owner per project, signed in again for each test (a new magic link
// replaces the old one), so keep the tests in this file one after another.
test.describe.configure({ mode: "serial" });

const businessFor = (project: string) => (project === "mobile" ? "tutor" : "mechanic");
const randomPhone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const INVOICE_URL = /\/dashboard\/invoices\/[0-9a-f-]{36}$/;

/** The manual (cash/card/bank) form sits in a <details> under the M-Pesa form. */
async function manualPayments(page: Page) {
  const details = page.locator("details", { hasText: "Record a cash, card or bank payment" });
  if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
    await details.locator("summary").click();
  }
  return details;
}

async function fillFirstItem(page: Page, description: string, qty: string, price: string) {
  await page.getByLabel("Item 1 description").fill(description);
  await page.getByLabel("Qty").first().fill(qty);
  await page.getByLabel("Unit price (KES)").first().fill(price);
}

test("invoice: draft → issue → part payment → paid → shared link and PDF", async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  const type = businessFor(testInfo.project.name);
  const name = `Invoice Guest ${Math.random().toString(36).slice(2, 7)}`;
  await signIn(page, `owner+${type}@nextto.test`, "/dashboard/invoices/new");
  await expect(page.getByRole("heading", { name: /New invoice/ })).toBeVisible();

  await page.getByLabel("Phone").fill(randomPhone());
  await page.getByLabel("Name", { exact: true }).fill(name);
  await fillFirstItem(page, "Full service", "2", "500");
  await page.getByLabel("VAT").selectOption("0");
  await expect(page.getByTestId("editor-total")).toHaveText(/1,000/);

  await expectNoSideScroll(page);
  await page.getByRole("button", { name: "Save draft invoice" }).click();
  await expect(page).toHaveURL(INVOICE_URL);

  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByTestId("doc-number")).toHaveText(/INV-\d{4}-\d{4}/);
  await expect(page.getByTestId("doc-balance")).toHaveText(/1,000/);

  // A partial cash payment, then the rest (the form suggests the balance).
  await expectNoSideScroll(page);
  let manual = await manualPayments(page);
  await manual.getByLabel("Amount (KES)").fill("400");
  await manual.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("doc-balance")).toHaveText(/600/);
  await expect(page.getByText(/Invoice · Part paid/)).toBeVisible();

  manual = await manualPayments(page);
  await expect(manual.getByLabel("Amount (KES)")).toHaveValue("600");
  await manual.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Invoice · Paid/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toBeHidden();

  // The share link works without signing in, and so does its PDF.
  const shareUrl = (await page.getByTestId("share-url").textContent())!.trim();
  const guest = await browser.newContext();
  const shared = await guest.newPage();
  await shared.goto(shareUrl);
  await expect(shared.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(shared.getByText(name)).toBeVisible();
  await expectNoSideScroll(shared);
  await expect(shared.getByTestId("doc-balance")).toHaveText(/^Ksh\s*0(\.00)?$/);
  const pdf = await guest.request.get(`${shareUrl}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await guest.close();
});

test("quote: issue → accept → becomes a draft invoice", async ({ page }, testInfo) => {
  const type = businessFor(testInfo.project.name);
  await signIn(page, `owner+${type}@nextto.test`, "/dashboard/invoices/new?kind=quote");
  await expect(page.getByRole("heading", { name: /New quote/ })).toBeVisible();

  await page.getByLabel("Phone").fill(randomPhone());
  await page.getByLabel("Name", { exact: true }).fill("Quote Guest");
  await fillFirstItem(page, "Engine overhaul", "1", "25000");
  await page.getByRole("button", { name: "Save draft quote" }).click();
  await expect(page).toHaveURL(INVOICE_URL);
  const quoteUrl = page.url();

  await page.getByRole("button", { name: "Issue quote" }).click();
  await expect(page.getByTestId("doc-number")).toHaveText(/QUO-\d{4}-\d{4}/);
  await page.getByRole("button", { name: "Accept → invoice" }).click();

  await page.waitForURL((url) => INVOICE_URL.test(url.pathname) && url.href !== quoteUrl);
  await expect(page.getByLabel("Item 1 description")).toHaveValue("Engine overhaul");
  await expect(page.getByRole("button", { name: "Issue invoice" })).toBeVisible();
});

test("a booking can be invoiced from its page", async ({ page }, testInfo) => {
  const type = businessFor(testInfo.project.name);
  const name = `Booked Guest ${Math.random().toString(36).slice(2, 7)}`;
  await signIn(page, `owner+${type}@nextto.test`, "/dashboard/bookings/new");

  // A fresh walk-in, outside opening hours on a random future day, so it never clashes.
  const days = 30 + Math.floor(Math.random() * 300);
  const date = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const time = `0${Math.floor(Math.random() * 5)}:${String(Math.floor(Math.random() * 12) * 5).padStart(2, "0")}`;
  await page.getByLabel("Phone").fill(randomPhone());
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Time").fill(time);
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookings\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Invoice this booking" }).click();
  await expect(page).toHaveURL(INVOICE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByLabel("Item 1 description")).not.toHaveValue("");
});
