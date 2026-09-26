import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CHECK_PROMPT, COUNSELOR_VERSION, type InstallerConfig } from "./installer";
import { MAC_DIR, MAC_INSTALLER_NAME, MAC_LABEL, MAC_WATCHER_NAME, macInstaller, macInstallerZip } from "./mac-installer";

const CONFIG: InstallerConfig = {
  site: "https://desk.example.com/",
  supabaseUrl: "https://abcd.supabase.co",
  // Obviously fake, low-entropy values (the secret scan flags anything that looks real).
  supabaseKey: "example_key",
  token: "example-token-aaaaaaaaaaaa",
};

/** The text between a heredoc's opening line and its end marker. */
function heredoc(script: string, opener: string, marker: string): string {
  const lines = script.split("\n");
  const start = lines.findIndex((l) => l.includes(opener));
  const end = lines.indexOf(marker, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start + 1, end).join("\n") + "\n";
}

// Tools to check the scripts with, where this machine has them (CI's Linux and macOS do).
const unix = process.platform !== "win32";
const has = (cmd: string) => unix && spawnSync(cmd, ["--version"]).status === 0;

describe("macInstaller", () => {
  const out = macInstaller(CONFIG);

  it("is a bash script, plain ASCII with Unix line endings", () => {
    expect(out.startsWith("#!/bin/bash\n")).toBe(true);
    expect(out).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
  });

  it("fills in every value, and nothing is left unfilled", () => {
    expect(out).toContain("SITE='https://desk.example.com'");
    expect(out).toContain("SUPABASE_URL='https://abcd.supabase.co'");
    expect(out).toContain(`KEY='${CONFIG.supabaseKey}'`);
    expect(out).toContain(`TOKEN='${CONFIG.token}'`);
    expect(out.split(`'${CHECK_PROMPT}'`).length - 1).toBe(2);
    expect(out).not.toMatch(/__[A-Z_]+__/);
  });

  it("writes the watcher, the brief and a way to turn it off, each whole", () => {
    const watcher = heredoc(out, `cat > "$WATCHER" <<'AVERAGEAPP_WATCHER'`, "AVERAGEAPP_WATCHER");
    expect(watcher.startsWith("#!/usr/bin/perl\n")).toBe(true);
    expect(watcher).toContain(`my $Version = '${COUNSELOR_VERSION}';`);
    for (const fn of ["connector_counselor_poll", "connector_draft_answer", "connector_finish_request", "connector_activity", "connector_counselor_removed"]) {
      expect(watcher).toContain(`'${fn}'`);
    }
    expect(watcher).toContain("'mcp__application-desk'");
    expect(watcher).toContain(`/${MAC_LABEL}.plist`);
    // Every model the website offers, switched in place in the running Claude Code.
    expect(watcher).toContain("qw(haiku sonnet opus fable)");
    expect(watcher).toContain("subtype => 'set_model'");
    expect(heredoc(out, "cat > CLAUDE.md <<'AVERAGEAPP_BRIEF'", "AVERAGEAPP_BRIEF")).toContain("# Average App counselor");
    expect(heredoc(out, `cat > "Turn off counselor.command" <<'AVERAGEAPP_OFF'`, "AVERAGEAPP_OFF")).toContain(`bootout "gui/$(id -u)/${MAC_LABEL}"`);
  });

  it("starts at login through a LaunchAgent that restarts it only after a crash", () => {
    expect(out).toContain(`LABEL='${MAC_LABEL}'`);
    expect(out).toContain(`DIR="$HOME/${MAC_DIR}"`);
    expect(out).toContain(`WATCHER="$DIR/${MAC_WATCHER_NAME}"`);
    expect(out).toContain("<key>SuccessfulExit</key>\n    <false/>");
    expect(out).toContain('/bin/launchctl bootstrap "gui/$UIDN" "$PLIST"');
  });

  it("refuses values that could break out of the script", () => {
    expect(() => macInstaller({ ...CONFIG, token: "x'; rm -rf ~; '" })).toThrow();
    expect(() => macInstaller({ ...CONFIG, supabaseKey: "a b" })).toThrow();
    expect(() => macInstaller({ ...CONFIG, site: "https://desk.example.com/$(whoami)" })).toThrow();
  });

  it.runIf(has("bash"))("is valid bash", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-setup-"));
    writeFileSync(join(dir, "setup.command"), out);
    const r = spawnSync("bash", ["-n", join(dir, "setup.command")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.runIf(has("perl"))("has a watcher that is valid Perl", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-watcher-"));
    writeFileSync(join(dir, "watcher.pl"), heredoc(out, `cat > "$WATCHER" <<'AVERAGEAPP_WATCHER'`, "AVERAGEAPP_WATCHER"));
    const r = spawnSync("perl", ["-c", join(dir, "watcher.pl")], { encoding: "utf8" });
    expect(r.stderr).toContain("syntax OK");
    expect(r.status).toBe(0);
  });
});

describe("macInstallerZip", () => {
  it("holds just the setup, marked executable, so a double-click runs it", async () => {
    const zip = await macInstallerZip(CONFIG);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([MAC_INSTALLER_NAME]);
    expect(strFromU8(files[MAC_INSTALLER_NAME])).toBe(macInstaller(CONFIG));
    // The central directory's entry: "made by" Unix (3), with mode -rwxr-xr-x in its external attributes.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const at = zip.findIndex((_, i) => view.getUint32(i, true) === 0x02014b50);
    expect(at).toBeGreaterThan(0);
    expect(view.getUint8(at + 5)).toBe(3);
    expect(view.getUint32(at + 38, true) >>> 16).toBe(0o100755);
  });
});
