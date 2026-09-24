import { describe, expect, it } from "vitest";
import { counselorInstaller, WAKE_PROMPT, type InstallerConfig } from "./installer";

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
    expect(out).toContain(WAKE_PROMPT);
    expect(out).not.toMatch(/__[A-Z_]+__/);
    // PowerShell's own "$_" survives the substitutions.
    expect(out).toContain("$_.CommandLine");
  });

  it("writes the watcher, the counselor's brief and a way to turn it off", () => {
    for (const name of ["watch.ps1", "CLAUDE.md", "stop.ps1", "Turn off counselor.cmd", "mcp.json", "config.json"]) {
      expect(out).toContain(`Save '${name}'`);
    }
    expect(out).toContain("mcp__application-desk");
    expect(out).toContain("connector_counselor_poll");
    // Every here-string is closed at the start of a line.
    const opens = out.match(/@'\r\n/g)?.length ?? 0;
    const closes = out.match(/\r\n'@/g)?.length ?? 0;
    expect(opens).toBe(4);
    expect(closes).toBe(4);
  });

  it("refuses values that could break out of the script", () => {
    expect(() => counselorInstaller({ ...CONFIG, token: "abc'; Remove-Item x; '12345678901234567890" })).toThrow();
    expect(() => counselorInstaller({ ...CONFIG, site: "https://x.com/'" })).toThrow();
    expect(() => counselorInstaller({ ...CONFIG, supabaseKey: "key with space" })).toThrow();
  });
});
