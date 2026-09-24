import { describe, expect, it } from "vitest";
import { DAY, HIST_BYTES, HIST_KEEP, HOUR, MINUTE, trimHistory, type VersionLike } from "./history";

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const v = (at: number, size: number): VersionLike => ({ at, size });

function medianGap(list: VersionLike[], fromAge: number, toAge: number): number | null {
  const band = list.filter((x) => NOW - x.at >= fromAge && NOW - x.at < toAge);
  const gaps: number[] = [];
  for (let i = 1; i < band.length; i++) gaps.push(band[i].at - band[i - 1].at);
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
}

describe("trimHistory", () => {
  // A year of work: every 10 minutes, six hours a day.
  const year: VersionLike[] = [];
  for (let d = 365; d >= 0; d--) {
    for (let m = 0; m < 36; m++) year.push(v(NOW - d * DAY + m * 10 * MINUTE - 6 * HOUR, 3000));
  }
  const kept = trimHistory(year, NOW);

  it("keeps the first and newest versions of a year of work", () => {
    expect(kept[0].at).toBe(year[0].at);
    expect(kept.at(-1)!.at).toBe(year.at(-1)!.at);
    expect(NOW - kept[0].at).toBeGreaterThan(360 * DAY);
  });

  it("fits the count and size caps", () => {
    expect(kept.length).toBeLessThanOrEqual(HIST_KEEP);
    expect(kept.reduce((a, x) => a + x.size, 0)).toBeLessThanOrEqual(HIST_BYTES);
  });

  it("keeps recent versions close and old ones far apart", () => {
    const dayGap = medianGap(kept, 0, DAY)!;
    const oldGap = medianGap(kept, 30 * DAY, 400 * DAY)!;
    expect(dayGap).toBeLessThanOrEqual(3 * HOUR);
    expect(oldGap).toBeGreaterThanOrEqual(3 * DAY);
    expect(oldGap / dayGap).toBeGreaterThanOrEqual(8);
  });

  it("keeps an afternoon of edits whole", () => {
    const day = Array.from({ length: 20 }, (_, m) => v(NOW - (20 - m) * 2 * MINUTE, 2000));
    expect(trimHistory(day, NOW)).toHaveLength(20);
  });

  it("thins a week of hourly saves to about one a day beyond the last day", () => {
    const week = Array.from({ length: 24 * 6 }, (_, h) => v(NOW - 6 * DAY + h * HOUR, 1500));
    const wk = trimHistory(week, NOW);
    expect(wk.filter((x) => NOW - x.at < DAY).length).toBeGreaterThanOrEqual(20);
    const older = wk.filter((x) => NOW - x.at >= DAY);
    expect(older.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < older.length; i++) {
      expect(older[i].at - older[i - 1].at).toBeGreaterThanOrEqual(20 * HOUR);
    }
    expect(wk[0].at).toBe(week[0].at);
  });

  it("does not evict the first version for an oversized middle one", () => {
    const big = [v(NOW - 200 * DAY, 1000), v(NOW - 100 * DAY, HIST_BYTES), v(NOW - MINUTE, 1000)];
    const out = trimHistory(big, NOW);
    expect(out[0].at).toBe(big[0].at);
    expect(out.at(-1)!.at).toBe(big[2].at);
    expect(out.reduce((a, x) => a + x.size, 0)).toBeLessThanOrEqual(HIST_BYTES);
  });

  it("leaves one or two versions alone and accepts unsorted input", () => {
    expect(trimHistory([v(NOW, 1)], NOW)).toHaveLength(1);
    const out = trimHistory([v(NOW, 1), v(NOW - DAY * 30, 1), v(NOW - MINUTE, 1)], NOW);
    expect(out.map((x) => x.at)).toEqual([NOW - DAY * 30, NOW - MINUTE, NOW]);
  });

  it("is stable when run again later", () => {
    const again = trimHistory(kept, NOW + HOUR);
    expect(again[0].at).toBe(year[0].at);
    expect(again.at(-1)!.at).toBe(year.at(-1)!.at);
  });
});
