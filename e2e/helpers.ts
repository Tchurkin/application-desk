import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** A fresh, obviously fake student for each test. */
export function fakeStudent(tag: string) {
  const n = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return { name: "Testy", email: `testy+${tag}${n}@example.test`, password: "correct-horse-battery" };
}

export async function signUp(page: Page, tag: string) {
  const s = fakeStudent(tag);
  await page.goto("/login?mode=signup");
  await page.getByLabel("Your first name").fill(s.name);
  await page.getByLabel("Email").fill(s.email);
  await page.getByLabel("Password").fill(s.password);
  await page.getByRole("button", { name: "Create my desk" }).click();
  await expect(page).toHaveURL(/\/desk$/);
  return s;
}

export async function addCollege(
  page: Page,
  name: string,
  opts: { deadline?: string; system?: string; letters?: boolean } = {},
) {
  await page.goto("/desk");
  const details = page.locator("details", { hasText: "Add a college" });
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator("summary").click();
  await details.getByLabel("College", { exact: true }).fill(name);
  if (opts.system) await details.getByLabel("Applied through").selectOption(opts.system);
  if (opts.deadline) await details.getByLabel("Application deadline").fill(opts.deadline);
  if (opts.letters === false) await details.getByLabel("Needs recommendation letters").uncheck();
  await details.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("/").pop()!;
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
