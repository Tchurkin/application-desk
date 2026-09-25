import { expect, test } from "@playwright/test";
import { codeSignIn, fakeStudent, signUp } from "./helpers";

/*
 * Signing in with a code emailed to the student. The local Supabase keeps its email in Mailpit
 * rather than sending it, so the test reads the code from there, as the student would from their
 * inbox.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function codeFromEmail(email: string): Promise<string> {
  let found: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await search.json()) as { messages?: { ID: string }[] };
        if (!messages?.length) return null;
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text?: string; HTML?: string };
        found = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[1] ?? null;
        return found;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  return found!;
}

test.describe("with an emailed code", () => {
  test.skip(!codeSignIn, "The site signs in with passwords here.");

  test("a student starts a desk with a code emailed to them, no password", async ({ page }) => {
    const s = fakeStudent("code");
    await page.goto("/login?mode=signup");
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await page.getByLabel("Your first name").fill("Testy");
    await page.getByLabel("Email").fill(s.email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(s.email)).toBeVisible();

    await page.getByLabel("Code").fill(await codeFromEmail(s.email));
    await page.getByRole("button", { name: "Create my desk" }).click();
    await expect(page).toHaveURL(/\/desk$/);
    await expect(page.getByRole("heading", { name: "Testy's board" })).toBeVisible();
  });

  test("a wrong code is refused, and an email with no desk is told so", async ({ page, browser }) => {
    const s = await signUp(page, "wrongcode");
    const other = await browser.newContext();
    const tab = await other.newPage();
    await tab.goto(`/login?step=code&email=${encodeURIComponent(s.email)}`);
    await tab.getByLabel("Code").fill("000000");
    await tab.getByRole("button", { name: "Sign in" }).click();
    await expect(tab.getByRole("alert").filter({ hasText: "That code didn't work" })).toBeVisible();

    await tab.goto("/login");
    await tab.getByLabel("Email").fill(fakeStudent("nobody").email);
    await tab.getByRole("button", { name: "Email me a code" }).click();
    await expect(tab.getByRole("alert").filter({ hasText: "There's no desk with that email yet" })).toBeVisible();
    await other.close();
  });
});
