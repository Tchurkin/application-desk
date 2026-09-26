import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { apiClient, signUp } from "./helpers";

async function makeConnector(page: Page) {
  const back = page.url();
  await page.goto("/desk/settings/connectors");
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

const notes = (p: Page) => p.getByTestId("profile-section");
const files = (p: Page) => p.getByTestId("profile-file");
const note = (p: Page) => p.getByTestId("profile-note");

/** A school's one-page form for Testy, with a name field and a checkbox. */
async function schoolForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Records release for Testy Student", { x: 50, y: 740, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const form = doc.getForm();
  form.createTextField("student_name").addToPage(page, { x: 50, y: 680, width: 300, height: 20 });
  form.createCheckBox("waive").addToPage(page, { x: 50, y: 650, width: 12, height: 12 });
  return Buffer.from(await doc.save());
}

test("the profile: notes by hand and by Claude, read with every piece", async ({ page }) => {
  await signUp(page, "profile");
  const client = await connect(await makeConnector(page));
  await page.goto("/desk/profile");
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();

  // A new note opens over the page.
  await page.getByRole("button", { name: "New note" }).click();
  await note(page).getByLabel("Note name").fill("Robotics");
  await note(page).getByLabel("Note text").fill("Captain of the robotics team.");
  await note(page).getByRole("button", { name: "Close" }).click();
  await expect(note(page)).toHaveCount(0);
  // Saved as typed: Claude reads it, and it's there after a reload, folded to one line.
  await expect.poll(async () => (await call(client, "read_profile")).text).toContain("Captain of the robotics team.");
  expect((await call(client, "read_profile")).text).toContain("### Robotics [section_id:");
  await page.reload();
  await expect(notes(page).first()).toContainText("Robotics");
  await expect(page.getByLabel("Note text")).toHaveCount(0);
  await notes(page).first().getByRole("button").first().click();
  await expect(note(page).getByLabel("Note name")).toHaveValue("Robotics");
  await expect(note(page).getByLabel("Note text")).toHaveValue("Captain of the robotics team.");
  await note(page).getByRole("button", { name: "Close" }).click();

  // Claude's notes appear live.
  const added = await call(client, "save_profile_section", { title: "Family", body: "Oldest of three." });
  expect(added.isError).toBe(false);
  await expect(notes(page)).toHaveCount(2);
  await expect(notes(page).nth(1)).toContainText("Family");

  // Moving a note, and the order Claude sees.
  await page.getByRole("button", { name: "Move Family up" }).click();
  await expect(notes(page).first()).toContainText("Family");
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

test("profile files: the student uploads a form, and the counselor reads it and fills in a copy", async ({ page }) => {
  await signUp(page, "files");
  const client = await connect(await makeConnector(page));
  await page.goto("/desk/profile");

  // A PDF is kept as a file; a Markdown file becomes a note.
  await page.getByTestId("profile-upload").setInputFiles([
    { name: "Records release.pdf", mimeType: "application/pdf", buffer: await schoolForm() },
    { name: "Robotics story.md", mimeType: "text/markdown", buffer: Buffer.from("Testy rebuilt the **arm** twice.") },
  ]);
  await expect(files(page)).toHaveCount(1);
  await expect(files(page).first()).toContainText("Records release.pdf");
  await expect(files(page).first()).toContainText("PDF");
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toContainText("Robotics story");

  // Opening it shows the PDF over the page.
  await files(page).first().getByRole("button").click();
  const open = page.getByTestId("profile-file-open");
  await expect(open.locator("iframe")).toBeVisible();
  await expect(open.getByRole("link", { name: "Download" })).toHaveAttribute("download", "Records release.pdf");
  await open.getByRole("button", { name: "Close" }).click();

  // The counselor finds it on the profile, reads its fields, and fills in a copy.
  const profile = (await call(client, "read_profile")).text;
  const id = profile.match(/Records release\.pdf \(PDF, [^)]*\) \[file_id: ([0-9a-f-]{36})\]/)![1];
  const read = await call(client, "read_profile_file", { file_id: id });
  expect(read.isError, read.text).toBe(false);
  expect(read.text).toContain('"student_name" (text)');
  expect(read.text).toContain("Records release for Testy Student");
  const filled = await call(client, "fill_pdf_form", { file_id: id, fields: { student_name: "Testy Student", waive: true, nope: "x" } });
  expect(filled.isError, filled.text).toBe(false);
  expect(filled.text).toContain('saved "Records release (filled).pdf"');
  expect(filled.text).toContain('"nope": no field has that name');

  // The copy shows up live, and holds the answers; the original is as it was.
  await expect(files(page)).toHaveCount(2);
  await expect(files(page).nth(1)).toContainText("Records release (filled).pdf");
  await expect(files(page).nth(1)).toContainText("filled in by");
  const copy = filled.text.match(/file_id: ([0-9a-f-]{36})/)![1];
  expect((await call(client, "read_profile_file", { file_id: copy })).text).toContain('now "Testy Student"');
  expect((await call(client, "read_profile_file", { file_id: id })).text).not.toContain('now "Testy Student"');

  // Deleting the original.
  await files(page).first().getByRole("button").click();
  await open.getByRole("button", { name: "Delete" }).click();
  await open.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(open).toHaveCount(0);
  await expect(files(page)).toHaveCount(1);
  await expect.poll(async () => (await call(client, "read_profile")).text).not.toContain("Records release.pdf (");
  expect((await call(client, "read_profile_file", { file_id: id })).isError).toBe(true);
  await client.close();
});

test("starting the interview opens the counselor chat, where it runs, and each turn is picked up once", async ({ page }) => {
  await signUp(page, "interview");
  const url = await makeConnector(page);
  const token = url.split("/api/mcp/")[1];
  const client = await connect(url);
  await page.goto("/desk/profile");

  await page.getByTestId("interview").getByRole("button", { name: "Start the interview" }).click();
  await expect(page).toHaveURL(/\/desk\/counselor$/);
  const chat = page.getByTestId("counselor-chat");
  await expect(chat).toContainText("You started the profile interview");
  await expect(chat).toContainText("Waiting for Claude");

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
  await expect(chat).toContainText("What got you into robotics?");

  // The answer is a chat message; the counselor is told to save it to the profile.
  await chat.getByLabel("Message your counselor").fill("Taking apart my dad's old radio.");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat).toContainText("Waiting for Claude");
  const next = await call(client, "list_desk_requests");
  expect(next.text).toContain("Taking apart my dad's old radio.");
  expect(next.text).toContain("save_profile_section");
  expect((await api.rpc("connector_counselor_poll", { token })).data).toMatchObject({ fresh: 1, waiting: 1 });
  await client.close();
});

test("a pasted transcript goes to the counselor, who fills in the academics", async ({ page }) => {
  await signUp(page, "transcript");
  const client = await connect(await makeConnector(page));
  await page.goto("/desk/profile");
  const card = page.getByTestId("academics");
  const transcript = "Grade 11: AP Physics A, AP Calculus BC A-\nCumulative GPA 3.87 unweighted, 4.21 weighted\nClass rank 12/412";
  await card.getByRole("button", { name: "Paste your transcript" }).click();
  await card.getByLabel("Your transcript").fill(transcript);
  await card.getByRole("button", { name: "Send to your counselor" }).click();
  const status = card.getByTestId("transcript-status");
  await expect(status).toContainText("Your transcript is with your counselor");

  // The assistant gets it whole, with what to save.
  const waiting = await call(client, "list_desk_requests");
  expect(waiting.text).toContain("(kind: transcript)");
  expect(waiting.text).toContain("AP Calculus BC A-");
  expect(waiting.text).toContain("update_academics");
  const id = waiting.text.match(/\[request_id: ([0-9a-f-]{36})\]/)![1];
  const saved = await call(client, "update_academics", {
    gpa: "3.87 unweighted, 4.21 weighted",
    class_rank: "12 of 412",
    coursework: "Grade 11: AP Physics A, AP Calculus BC A-",
  });
  expect(saved.isError, saved.text).toBe(false);
  expect((await call(client, "answer_request", { request_id: id, answer: "Saved your GPA, class rank and coursework." })).isError).toBe(false);

  // The answer arrives and the fields show what was saved, without a reload.
  await expect(status).toContainText("Saved your GPA, class rank and coursework.", { timeout: 15_000 });
  await expect(card.getByLabel("GPA", { exact: true })).toHaveValue("3.87 unweighted, 4.21 weighted", { timeout: 15_000 });
  await expect(card.getByLabel("Class rank", { exact: true })).toHaveValue("12 of 412");
  await expect(card.getByLabel("Coursework", { exact: true })).toHaveValue("Grade 11: AP Physics A, AP Calculus BC A-");
  // The assistant reads them back with the profile.
  expect((await call(client, "read_profile")).text).toContain("Class rank: 12 of 412");

  // The counselor chat keeps it, folded to one line.
  await page.goto("/desk/counselor");
  const chat = page.getByTestId("counselor-chat");
  await expect(chat.getByText("You shared your transcript")).toBeVisible();
  await expect(chat).toContainText("Saved your GPA, class rank and coursework.");

  // Academics left Settings.
  await page.goto("/desk/settings/academics");
  await expect(page).toHaveURL(/\/desk\/profile/);
  await expect(page.getByRole("navigation", { name: "Settings" })).toHaveCount(0);
  await client.close();
});
