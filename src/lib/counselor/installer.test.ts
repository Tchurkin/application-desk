import { describe, expect, it } from "vitest";
import { CHECK_PROMPT, COUNSELOR_VERSION, counselorInstaller, type InstallerConfig } from "./installer";

const CONFIG: InstallerConfig = {
  site: "https://desk.example.com/",
  supabaseUrl: "https://abcd.supabase.co",
  // Obviously fake, low-entropy values (the secret scan flags anything that looks real).
  supabaseKey: "example_key",
  token: "example-token-aaaaaaaaaaaa",
};

describe("counselorInstaller", () => {
  const out = counselorInstaller(CONFIG);

  it("is a batch file that hands itself to PowerShell", () => {
    const lines = out.split("\r\n");
    expect(lines[0].startsWith("<# :")).toBe(true);
    expect(lines).toContain("@echo off");
    expect(lines).toContain("exit /b");
    expect(lines).toContain("#>");
  });

  it("is plain ASCII with Windows line endings only", () => {
    expect(out).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("fills in every value, and nothing is left unfilled", () => {
    expect(out).toContain("$Site = 'https://desk.example.com'");
    expect(out).toContain("$SupabaseUrl = 'https://abcd.supabase.co'");
    expect(out).toContain(`$Key = '${CONFIG.supabaseKey}'`);
    expect(out).toContain(`$Token = '${CONFIG.token}'`);
    expect(out.split(CHECK_PROMPT).length - 1).toBe(2);
    expect(out).not.toMatch(/__[A-Z_]+__/);
    // PowerShell's own "$_" and "$m" survive the substitutions.
    expect(out).toContain("$_.CommandLine");
    expect(out).toContain("'\\u{0:x4}' -f [int][char]$m.Value");
  });

  it("writes the watcher, the counselor's brief and a way to turn it off", () => {
    for (const name of ["watch.ps1", "CLAUDE.md", "stop.ps1", "Turn off counselor.cmd", "mcp.json", "config.json"]) {
      expect(out).toContain(`Save '${name}'`);
    }
    expect(out).toContain("mcp__application-desk");
    // Every here-string is closed at the start of a line.
    const opens = out.match(/@'\r\n/g)?.length ?? 0;
    const closes = out.match(/\r\n'@/g)?.length ?? 0;
    expect(opens).toBe(4);
    expect(closes).toBe(4);
  });

  it("keeps one Claude Code running and streams its answers onto the desk", () => {
    expect(out).toContain(`$Version = '${COUNSELOR_VERSION}'`);
    for (const flag of ["--input-format', 'stream-json'", "--output-format', 'stream-json'", "--include-partial-messages", "--restricted"]) {
      expect(out).toContain(flag);
    }
    expect(out).toContain("$psi.EnvironmentVariables['ENABLE_TOOL_SEARCH'] = 'false'");
    for (const fn of ["connector_counselor_poll", "connector_draft_answer", "connector_finish_request", "connector_activity", "connector_counselor_removed"]) {
      expect(out).toContain(`'${fn}'`);
    }
    expect(out).toContain("$WorkUrl = $Cfg.site + '/api/counselor/' + $Cfg.token");
    // Every model the website offers, switched in place in the running Claude Code.
    expect(out).toContain("$Models = @('haiku', 'sonnet', 'opus', 'fable')");
    expect(out).toContain("subtype = 'set_model'");
    expect(out).toContain("$flags = @('--model', $model, '--effort', $effort)");
  });

  it("removes its startup shortcut under the old name too, so an update over one leaves just one", () => {
    expect(out).toContain("foreach ($lnkName in @('Average App counselor.lnk', 'Application Desk counselor.lnk'))");
    // Removed from the website and its link revoked (the watcher), turned off (stop.ps1, also run
    // first thing by the installer to stop an older one), and just before the new one is made.
    expect(out.split("foreach ($lnkName in").length - 1).toBe(5);
    expect(out).not.toContain("GetFolderPath('Startup')) 'Application Desk counselor.lnk'");
  });

  it("can remove itself, its conversation and its folder", () => {
    expect(out).toContain("function Remove-Counselor");
    expect(out).toContain("if ($r.remove) { Remove-Counselor }");
    expect(out).toContain("$_.Name -like '*ApplicationDesk-Counselor'");
    expect(out).toContain("rmdir /s /q");
  });

  it("refuses values that could break out of the script", () => {
    expect(() => counselorInstaller({ ...CONFIG, token: "abc'; Remove-Item x; '12345678901234567890" })).toThrow();
    expect(() => counselorInstaller({ ...CONFIG, site: "https://x.com/'" })).toThrow();
    expect(() => counselorInstaller({ ...CONFIG, supabaseKey: "key with space" })).toThrow();
  });
});
