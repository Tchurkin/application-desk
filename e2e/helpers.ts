import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** A fresh, obviously fake student for each test. */
export function fakeStudent(tag: string) {
  const n = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return { name: "Testy", email: `testy+${tag}${n}@example.test`, password: "correct-horse-battery" };
}

/** Students sign in with an emailed code (NEXT_PUBLIC_SIGN_IN=code), or else with a password. */
export const codeSignIn = process.env.NEXT_PUBLIC_SIGN_IN === "code";

/** The test database's admin client (its service key exists only in the test environment). */
export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A sign-in code for this email, as the email would carry it (without sending one). */
export async function signInCode(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return data.properties.email_otp;
}

export async function signUp(page: Page, tag: string) {
  const s = fakeStudent(tag);
  if (codeSignIn) {
    // The account made directly (no email to wait for), then signed in with a real code.
    const { error } = await adminClient().auth.admin.createUser({
      email: s.email,
      password: s.password,
      email_confirm: true,
      user_metadata: { display_name: s.name },
    });
    if (error) throw error;
    await page.goto(`/login?step=code&email=${encodeURIComponent(s.email)}`);
    await page.getByLabel("Code").fill(await signInCode(s.email));
    await page.getByRole("button", { name: "Sign in" }).click();
  } else {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your first name").fill(s.name);
    await page.getByLabel("Email").fill(s.email);
    await page.getByLabel("Password").fill(s.password);
    await page.getByRole("button", { name: "Create my desk" }).click();
  }
  await expect(page).toHaveURL(/\/desk$/);
  return s;
}

export async function addCollege(
  page: Page,
  name: string,
  opts: { deadline?: string; system?: string; letters?: boolean } = {},
) {
  await page.goto("/desk/add/college");
  await page.getByLabel("College", { exact: true }).fill(name);
  if (opts.system) await page.getByLabel("Applied through").selectOption(opts.system);
  if (opts.deadline) await page.getByLabel("Application deadline").fill(opts.deadline);
  if (opts.letters === false) await page.getByLabel("Needs recommendation letters").uncheck();
  await page.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("/").pop()!;
}

/** Submit a college's whole application from the board. */
export async function submitCollege(page: Page, name: string) {
  await page.goto("/desk");
  const lane = page.getByRole("list", { name: "Colleges", exact: true }).getByRole("listitem", { name, exact: true });
  await lane.getByRole("button", { name: "Submit application" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(lane.getByTestId("submitted-tag")).toBeVisible();
}

export async function addPiece(page: Page, title: string, limit?: number) {
  await page.getByLabel("New piece").fill(title);
  if (limit) await page.locator("form", { hasText: "New piece" }).getByLabel("Limit", { exact: true }).fill(String(limit));
  await page.getByRole("button", { name: "Add piece" }).click();
  await expect(page).toHaveURL(/\/desk\/piece\//);
  await expect(essay(page)).toBeVisible();
  return page.url().split("/").pop()!;
}

export function essay(page: Page) {
  return page.getByTestId("essay");
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveText("Saved", { timeout: 15_000 });
}

export function apiClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** An API client signed in as this student, the way the site signs them in. */
export async function studentClient(s: { email: string; password: string }) {
  const api = apiClient();
  const { error } = codeSignIn
    ? await api.auth.verifyOtp({ email: s.email, token: await signInCode(s.email), type: "email" })
    : await api.auth.signInWithPassword({ email: s.email, password: s.password });
  if (error) throw error;
  return api;
}

/** The essay's own text: other people's carets and suggestion widgets left out. */
export async function essayText(page: Page) {
  return essay(page).evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll(".ProseMirror-widget, .collaboration-carets__caret").forEach((n) => n.remove());
    return c.textContent ?? "";
  });
}

export async function expectEssay(page: Page, text: string) {
  await expect.poll(() => essayText(page), { timeout: 10_000 }).toBe(text);
}

export async function expectEssayContains(page: Page, text: string) {
  await expect.poll(() => essayText(page), { timeout: 10_000 }).toContain(text);
}

/** The suggest plugin's keystroke log (test builds only), for failure messages. */
export async function suggestLog(page: Page) {
  return JSON.stringify(await page.evaluate(() => (window as unknown as { __suggestLog?: unknown[] }).__suggestLog ?? []));
}
