import { expect, test } from "@playwright/test";
import { magicLinkFor, signIn, uniqueEmail } from "./helpers";

test("protected pages redirect to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("invalid email shows a field error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  // What was typed survives the round trip, so it can be corrected, not retyped.
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
});

test("a bad magic link is rejected", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=nope&type=email&next=/dashboard");
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByText("That sign-in link is invalid or has expired")).toBeVisible();
});

test("owner signs up, onboards with a preset and invites staff who accepts", async ({
  page,
  browser,
}) => {
  const owner = uniqueEmail("owner");
  const staff = uniqueEmail("staff");
  const suffix = Date.now().toString(36);
  const name = `E2E Tutors ${suffix}`;

  // 1. Sign up via magic link; a new user lands on onboarding.
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/onboarding$/);

  // 2. Pick the tutor preset and create the business.
  await page.getByText("Tutor", { exact: true }).click();
  await expect(page.getByText("KCSE revision session (2 hours)")).toBeVisible();
  await page.getByLabel("Business name").fill(name);
  await expect(page.getByLabel("Booking page link")).toHaveValue(`e2e-tutors-${suffix}`);
  await page.getByLabel(/Business phone/).fill("0712 345 678");
  await page.getByLabel(/Your name/).fill("Mwalimu Otieno");
  await page.getByRole("button", { name: "Create my business" }).click();

  // 3. The dashboard shows preset services and the owner as staff.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const services = page.getByRole("region", { name: "Services" });
  await expect(services.getByText("One-to-one lesson (1 hour)")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Team" }).getByText("Mwalimu Otieno"),
  ).toBeVisible();

  // 4. Invite a staff member.
  const invitedAt = new Date(Date.now() - 1000);
  await page.getByPlaceholder("colleague@example.co.ke").fill(staff);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText(`Invitation emailed to ${staff}.`)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Team" }).getByRole("listitem").filter({ hasText: staff }),
  ).toContainText("staff");

  // 5. The invitee opens the email in their own browser and accepts.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await staffPage.goto(await magicLinkFor(staff, invitedAt));
  await expect(staffPage).toHaveURL(/\/invite\/[0-9a-f-]{36}$/);
  await expect(staffPage.getByText(staff)).toBeVisible();
  await staffPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(staffPage).toHaveURL(/\/dashboard$/);
  await expect(staffPage.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(staffPage.getByText("Staff", { exact: true })).toBeVisible();
  // Staff can't manage invitations: the form is owner-only (and RLS enforces it).
  await expect(staffPage.getByRole("form", { name: "Invite a team member" })).toHaveCount(0);

  // 6. Sign out.
  await staffPage.getByRole("button", { name: "Sign out" }).click();
  await expect(staffPage).toHaveURL(/\/$/);
  await staffContext.close();
});
