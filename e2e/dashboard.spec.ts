import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function choose(radio: Locator) {
  await radio.locator("xpath=..").click();
  await expect(radio).toBeChecked();
}

const randomPhone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const pad = (n: number) => String(n).padStart(2, "0");
/** A time between 00:00 and 04:55: outside opening hours, so it never clashes with seeded bookings. */
const earlyTime = () =>
  `${pad(Math.floor(Math.random() * 5))}:${pad(Math.floor(Math.random() * 12) * 5)}`;

// These tests sign in as the same seeded owner, and a new magic link replaces
// the previous one, so run them one after another (projects still run in parallel).
test.describe.configure({ mode: "serial" });

// Each Playwright project uses its own seeded business so parallel runs don't collide.
const businessFor = (project: string) => (project === "mobile" ? "clinic" : "photographer");

/** As a guest, pick the first service and the first day (from `offset`) with free times. */
async function pickGuestSlot(guest: Page, slug: string, offset: number) {
  await guest.goto(`/b/${slug}`);
  await choose(guest.getByRole("radio").first());
  const days = guest.getByRole("radiogroup", { name: "Day" }).getByRole("radio");
  const times = guest.getByRole("radiogroup", { name: /^Times on/ }).getByRole("radio");
  for (let i = offset; i < (await days.count()); i++) {
    await choose(days.nth(i));
    await expect(guest.getByText(/Finding free times/)).toBeHidden();
    if ((await times.count()) > 0) {
      const day = (await days.nth(i).getAttribute("value"))!;
      await choose(times.last());
      return day;
    }
  }
  throw new Error("no free time in the next two weeks");
}

test("owner sees a guest booking arrive live, then manages it", async ({
  page,
  browser,
}, testInfo) => {
  test.slow();
  const type = businessFor(testInfo.project.name);
  const slug = `demo-${type}`;
  const guestName = `Live Guest ${Math.random().toString(36).slice(2, 7)}`;

  // The guest picks a slot first so the owner knows which day to watch.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const day = await pickGuestSlot(guest, slug, 6);

  await signIn(page, `owner+${type}@nextto.test`, `/dashboard/calendar?view=day&date=${day}`);
  await expect(page).toHaveURL(/\/dashboard\/calendar/);
  await expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible({
    timeout: 15_000,
  });

  await guest.getByLabel("Full name").fill(guestName);
  await guest.getByLabel("Phone (M-Pesa)").fill(randomPhone());
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest).toHaveURL(/\/confirmed\//);
  await guestContext.close();

  // No reload: Supabase Realtime -> router.refresh() brings it in.
  const block = page.getByRole("link", { name: new RegExp(guestName) });
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText(guestName);
  await page.getByRole("button", { name: "Mark no-show" }).click();
  await expect(page.getByText("Marked as no-show.")).toBeVisible();
  await page.getByRole("button", { name: "Undo: back to confirmed" }).click();
  await expect(page.getByText("Marked as confirmed.")).toBeVisible();

  // Leftovers from earlier failed runs may hold some early slots: a clash is a
  // valid outcome (the exclusion constraint at work), so try another time.
  let time = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    time = earlyTime();
    await page.getByLabel("Time").fill(time);
    // Wait for the server action's POST so a stale clash message isn't misread.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Move booking" }).click(),
    ]);
    const outcome = page
      .getByText("Booking moved.")
      .or(page.getByText("That time clashes with another booking for this team member."));
    await expect(outcome).toBeVisible();
    if (await page.getByText("Booking moved.").isVisible()) break;
  }
  await expect(page.getByText("Booking moved.")).toBeVisible();
  await expect(page.getByText(new RegExp(`at ${time}–`))).toBeVisible();

  // Customer history and notes.
  await page.getByRole("link", { name: guestName }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(guestName);
  await page.getByRole("textbox", { name: "Notes" }).fill("Prefers afternoon appointments");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue(
    "Prefers afternoon appointments",
  );

  // Back to the booking and cancel it, through the confirm step.
  await page
    .getByRole("region", { name: "History" })
    .getByRole("listitem")
    .first()
    .getByRole("link")
    .click();
  await page.getByText("Cancel booking…").click();
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();
  await expect(page.getByText("Cancelled bookings can't be changed.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Reschedule" })).toHaveCount(0);
});

test("staff create a walk-in booking from the dashboard", async ({ page }, testInfo) => {
  const type = businessFor(testInfo.project.name);
  await signIn(page, `owner+${type}@nextto.test`, "/dashboard/calendar");
  await page.getByRole("link", { name: "New booking" }).click();
  await expect(page.getByRole("heading", { name: "New booking" })).toBeVisible();

  // Validation explains what's missing, and keeps what was typed.
  await page.getByLabel("Name").fill("Walk In");
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(page.getByText("Enter the customer's phone")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Walk In");

  const name = `Walk In ${Math.random().toString(36).slice(2, 7)}`;
  const date = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Phone").fill(randomPhone());
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Time").fill(earlyTime());
  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page).toHaveURL(/\/dashboard\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByText("From the dashboard")).toBeVisible();

  // It shows in that week's calendar.
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await page.goto(`/dashboard/calendar?view=week&date=${date}`);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();

  // Tidy up so reruns stay clash-free.
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByText("Cancel booking…").click();
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();
  await expect(page.getByText("Cancelled bookings can't be changed.")).toBeVisible();
});

test("customers can be searched by phone", async ({ page }, testInfo) => {
  const type = businessFor(testInfo.project.name);
  await signIn(page, `owner+${type}@nextto.test`, "/dashboard/customers");
  await page.getByRole("searchbox", { name: "Search by name or phone" }).fill("0712 345 678");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=0712/);
  await expect(page.getByRole("link", { name: /Wanjiku/ })).toBeVisible();
});
