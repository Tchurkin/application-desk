import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSetupSql, migrationFiles, PROBES } from "./setup-sql";

const root = join(__dirname, "..", "..", "..");
const migrations = join(root, "supabase", "migrations");
const target = join(root, "supabase", "setup.sql");

describe("supabase/setup.sql", () => {
  it("knows how to tell every migration already ran", () => {
    for (const m of migrationFiles(migrations)) expect(PROBES[m.version], m.name).toBeTruthy();
  });

  it("is built from the migrations as they are now (UPDATE_SETUP_SQL=1 rebuilds it)", () => {
    const built = buildSetupSql(migrations);
    if (process.env.UPDATE_SETUP_SQL) writeFileSync(target, built);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8").replace(/\r\n/g, "\n")).toBe(built);
  });

  it("applies every migration, in order, each once", () => {
    const built = buildSetupSql(migrations);
    const order = migrationFiles(migrations).map((m) => built.indexOf(`execute $m${m.version}$`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
