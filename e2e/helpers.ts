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
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  await page.goto(await magicLinkFor(email, sentAt));
}
