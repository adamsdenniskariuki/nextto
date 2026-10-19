import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: { ID: string; Created: string }[] };
type MailpitMessage = { HTML: string };

/** Poll Mailpit for the newest email to `to` and return its sign-in link. */
export async function magicLinkFor(to: string, after = new Date(0)): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = (await (
          await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        ).json()) as MailpitSearch;
        const latest = search.messages.find((m) => new Date(m.Created) >= after);
        if (!latest) return undefined;
        const msg = (await (
          await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)
        ).json()) as MailpitMessage;
        const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
        link = href?.replaceAll("&amp;", "&");
        return link;
      },
      { message: `magic link email for ${to}`, timeout: 15_000 },
    )
    .toBeTruthy();
  return link!;
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.nextto.test`;
}

/** Request a magic link from /login and follow it. */
export async function signIn(page: Page, email: string, next = "/dashboard") {
  const sentAt = new Date(Date.now() - 1000);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const sent = page.getByText("Check your inbox");
  const limited = page.getByText("Too many requests");
  // Auth allows one email per address per second (supabase/config.toml
  // max_frequency); serial tests can sign the same owner in faster than that.
  for (let attempt = 0; ; attempt++) {
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(sent.or(limited)).toBeVisible();
    if (await sent.isVisible()) break;
    expect(attempt, `still rate-limited sending a link to ${email}`).toBeLessThan(3);
    await page.waitForTimeout(1_500);
  }
  await page.goto(await magicLinkFor(email, sentAt));
}

/** Fail if anything (outside its own scroll container) pokes past the viewport. */
export async function expectNoSideScroll(page: Page) {
  // Compare with the device width: mobile browsers widen the layout viewport to fit overflow.
  const width = page.viewportSize()!.width;
  const overflowing = await page.evaluate(
    (w) =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > w + 1)
        // Content inside its own scroll container (e.g. a wide table) is fine.
        .filter((el) => {
          for (let a = el.parentElement; a; a = a.parentElement) {
            if (getComputedStyle(a).overflowX !== "visible") return false;
          }
          return true;
        })
        .filter(
          (el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= w + 1,
        )
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`),
    width,
  );
  expect(overflowing, `elements wider than ${width}px`).toEqual([]);
}
