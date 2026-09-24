import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, signUp } from "./helpers";

async function makeConnector(page: Page) {
  const back = page.url();
  await page.goto("/desk/settings");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const url = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  await page.goto(back);
  return url;
}

async function connect(url: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { text: r.content.map((c) => c.text ?? "").join("\n"), isError: !!r.isError };
}

const sections = (p: Page) => p.getByTestId("profile-section");

test("the profile: sections by hand and by Claude, read with every piece", async ({ page }) => {
  await signUp(page, "profile");
  const client = await connect(await makeConnector(page));
  await page.goto("/desk/profile");
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Add a section" }).click();
  await sections(page).first().getByLabel("Section title").fill("Robotics");
  await sections(page).first().getByRole("textbox").nth(1).fill("Captain of the robotics team.");
  await page.getByRole("heading", { name: "Profile", level: 1 }).click();
  // Saved as typed: Claude reads it, and it's there after a reload.
  await expect.poll(async () => (await call(client, "read_profile")).text).toContain("Captain of the robotics team.");
  expect((await call(client, "read_profile")).text).toContain("### Robotics [section_id:");
  await page.reload();
  await expect(sections(page).first().getByLabel("Section title")).toHaveValue("Robotics");
  await expect(sections(page).first().getByRole("textbox").nth(1)).toHaveValue("Captain of the robotics team.");

  // Claude's sections appear live.
  const added = await call(client, "save_profile_section", { title: "Family", body: "Oldest of three." });
  expect(added.isError).toBe(false);
  await expect(sections(page)).toHaveCount(2);
  await expect(sections(page).nth(1).getByLabel("Section title")).toHaveValue("Family");

  // Moving a section, and the order Claude sees.
  await sections(page).nth(1).getByRole("button", { name: "Move up" }).click();
  await expect(sections(page).first().getByLabel("Section title")).toHaveValue("Family");
  await expect
    .poll(async () => {
      const t = (await call(client, "read_profile")).text;
      return t.indexOf("### Family") < t.indexOf("### Robotics");
    })
    .toBe(true);

  // Every piece carries the profile.
  const made = await call(client, "create_piece", { title: "Personal statement" });
  const pieceId = made.text.match(/piece_id: ([0-9a-f-]{36})/)![1];
  const read = await call(client, "read_piece", { piece_id: pieceId });
  expect(read.text).toContain("## The student's profile");
  expect(read.text).toContain("Oldest of three.");
  await client.close();
});

test("the interview runs through the desk, and the counselor picks each turn up once", async ({ page }) => {
  await signUp(page, "interview");
  const url = await makeConnector(page);
  const token = url.split("/api/mcp/")[1];
  const client = await connect(url);
  await page.goto("/desk/profile");

  const interview = page.getByTestId("interview");
  await interview.getByRole("button", { name: "Start the interview" }).click();
  await expect(interview).toContainText("Waiting for Claude");

  // The counselor's watcher sees one new request, then nothing new.
  const api = apiClient();
  const first = await api.rpc("connector_counselor_poll", { token });
  expect(first.error).toBeNull();
  expect(first.data).toMatchObject({ fresh: 1, waiting: 1 });
  expect((await api.rpc("connector_counselor_poll", { token })).data).toMatchObject({ fresh: 0, waiting: 1 });
  const bad = await api.rpc("connector_counselor_poll", { token: "not-a-real-token-at-all-000000" });
  expect(bad.error?.message).toContain("not valid");

  // The page says the counselor is on.
  await page.reload();
  await expect(page.getByTestId("watch-status")).toContainText("Your counselor is on");

  const waiting = await call(client, "list_desk_requests");
  expect(waiting.text).toContain("profile interview");
  const id = waiting.text.match(/request_id: ([0-9a-f-]{36})/)![1];
  expect((await call(client, "answer_request", { request_id: id, answer: "What got you into robotics?" })).isError).toBe(false);
  await expect(interview).toContainText("What got you into robotics?");

  await interview.getByLabel("Your answer").fill("Taking apart my dad's old radio.");
  await interview.getByRole("button", { name: "Send answer" }).click();
  await expect(interview).toContainText("Waiting for Claude");
  const next = await call(client, "list_desk_requests");
  expect(next.text).toContain("Taking apart my dad's old radio.");
  expect(next.text).toContain("save_profile_section");
  expect((await api.rpc("connector_counselor_poll", { token })).data).toMatchObject({ fresh: 1, waiting: 1 });
  await client.close();
});
