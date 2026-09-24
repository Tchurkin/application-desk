import { labelOf, ROUNDS } from "@/lib/domain/colleges";
import { bandOf, BANDS, chanceOf, isInternational, LIKELY_ABOVE, REACH_BELOW, SOURCE_LABEL, formatPercent } from "./bands";
import type { CatalogEntry } from "./match";

/*
 * The connector's read_strategy text: the student's academic profile and, for every college,
 * its strategy fields beside the published College Scorecard baseline, so the assistant can
 * judge the student against each admitted class. Pure (the catalog is passed in) so it is tested.
 */

export interface StrategyInfo {
  student: { name: string; about: string; gpa: string; test_scores: string; intended_major: string } | null;
  colleges: {
    id: string;
    name: string;
    round: string;
    deadline: string | null;
    scorecard_id: number | null;
    chance_percent: number | string | null;
    chance_source: "ai" | "student" | null;
    chance_note: string;
    fit_rank: number | null;
    campus_life: number | null;
    reputation: number | null;
    cost_sticker: number | null;
    cost_net: number | null;
    country: string;
    intl_course: string;
    intl_criterion: string;
    intl_cost: string;
    intl_status: string;
    research: string;
  }[];
}

export interface CatalogLookup {
  match: (name: string, scorecardId: number | null) => CatalogEntry | null;
  candidates: (name: string) => CatalogEntry[];
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const bandTitle = (id: string) => BANDS.find((b) => b.id === id)?.title ?? id;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function profileLines(s: StrategyInfo["student"]): string[] {
  const lines: string[] = [];
  if (s?.name) lines.push(`Student: ${s.name}`);
  const parts = [
    s?.gpa && `GPA ${s.gpa}`,
    s?.test_scores && `test scores ${s.test_scores}`,
    s?.intended_major && `intended major ${s.intended_major}`,
  ].filter(Boolean);
  lines.push(
    parts.length
      ? `Academic profile: ${parts.join("; ")}.`
      : "Academic profile: not entered yet. Before estimating odds, ask the student for their GPA, test scores and intended major, and save them with update_academics.",
  );
  if (s?.about) lines.push(`About the student (in their words): ${s.about}`);
  return lines;
}

function baselineLine(c: StrategyInfo["colleges"][number], catalog: CatalogLookup): string {
  const e = catalog.match(c.name, c.scorecard_id);
  if (!e) {
    const many = catalog.candidates(c.name);
    if (many.length > 1) {
      const list = many.slice(0, 6).map((m) => `${m.name} (${m.city}, ${m.state}) [scorecard_id: ${m.id}]`);
      return `  Published baseline: several catalog colleges share this name: ${list.join("; ")}. Set scorecard_id to the right one.`;
    }
    return "  Published baseline: not in the College Scorecard catalog under this name (set scorecard_id if you know its UNITID).";
  }
  const facts = [
    `admission rate ${formatPercent(Math.round(e.rate * 1000) / 10)}`,
    e.sat && `average SAT ${e.sat}`,
    e.act && `average ACT ${e.act}`,
    e.cost && `cost of attendance ${usd.format(e.cost)}/yr${e.public ? " (in-state)" : ""}`,
    e.net && `average net price ${usd.format(e.net)}/yr`,
    e.public === undefined ? "" : e.public ? "public" : "private",
  ].filter(Boolean);
  return `  Published baseline (College Scorecard, ${e.name}, ${e.city}, ${e.state}): ${facts.join(", ")} [scorecard_id: ${e.id}]`;
}

function usCollege(c: StrategyInfo["colleges"][number], catalog: CatalogLookup): string[] {
  const e = catalog.match(c.name, c.scorecard_id);
  const lines = [
    `- ${c.name} [college_id: ${c.id}] ${labelOf(ROUNDS, c.round)}, deadline ${c.deadline ?? "not set"}`,
  ];
  const chance = chanceOf(c, e ? { rate: e.rate } : null);
  if (!chance) lines.push("  Chance: not set, and no published rate to fall back on (Unrated).");
  else if (chance.source === "average")
    lines.push(`  Chance: not set; the desk shows the published average rate, ${formatPercent(chance.value)} (${bandTitle(bandOf(chance.value))}).`);
  else
    lines.push(
      `  Chance: ${formatPercent(chance.value)} (${SOURCE_LABEL[chance.source]}, ${bandTitle(bandOf(chance.value))}).` +
        (c.chance_note ? ` Reasoning: ${c.chance_note}` : ""),
    );
  const more = [
    c.fit_rank != null && `fit rank #${c.fit_rank}`,
    c.campus_life != null && `campus life ${c.campus_life}/10`,
    c.reputation != null && `reputation ${c.reputation}/10`,
    c.cost_net != null && `net cost ${usd.format(Number(c.cost_net))}/yr`,
    c.cost_sticker != null && `sticker cost ${usd.format(Number(c.cost_sticker))}/yr`,
  ].filter(Boolean);
  if (more.length) lines.push(`  On the desk: ${more.join(", ")}.`);
  lines.push(baselineLine(c, catalog));
  if (c.research) lines.push(`  Student's research notes: ${clip(c.research.replace(/\s+/g, " "), 400)}`);
  return lines;
}

function abroadCollege(c: StrategyInfo["colleges"][number]): string[] {
  const facts = [
    `course: ${c.intl_course || "(not set)"}`,
    `what decides admission: ${c.intl_criterion || "(not set)"}`,
    `cost a year: ${c.intl_cost || "(not set)"}`,
    `where it stands: ${c.intl_status || "(not set)"}`,
  ];
  const lines = [`- ${c.name} [college_id: ${c.id}] ${c.country}; ${facts.join("; ")}`];
  if (c.fit_rank != null) lines.push(`  Fit rank #${c.fit_rank}.`);
  if (c.research) lines.push(`  Student's research notes: ${clip(c.research.replace(/\s+/g, " "), 400)}`);
  return lines;
}

export function renderStrategy(d: StrategyInfo, catalog: CatalogLookup): string {
  const lines = ["# Admission strategy", ...profileLines(d.student), ""];
  lines.push(
    `The desk sorts colleges into Reach (under ${REACH_BELOW}%), Target (${REACH_BELOW} to ${LIKELY_ABOVE}%) and Likely (over ${LIKELY_ABOVE}%). ` +
      "A college without a chance set is placed by its published average admission rate, which ignores the student's profile.",
  );
  const us = d.colleges.filter((c) => !isInternational(c.country));
  const abroad = d.colleges.filter((c) => isInternational(c.country));
  lines.push("", `## Colleges in the US (${us.length})`);
  if (!us.length) lines.push("None.");
  for (const c of us) lines.push(...usCollege(c, catalog));
  if (abroad.length) {
    lines.push("", `## Colleges outside the US (${abroad.length}): shown without a percentage`);
    for (const c of abroad) lines.push(...abroadCollege(c));
  }
  return lines.join("\n");
}
