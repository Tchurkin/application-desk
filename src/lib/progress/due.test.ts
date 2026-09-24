import { describe, expect, it } from "vitest";
import { dueInfo, localISODate, NEAR_DAYS, SOON_DAYS } from "./due";

const TODAY = "2030-10-01";

describe("dueInfo", () => {
  it("is null without a date", () => {
    expect(dueInfo(null, TODAY)).toBeNull();
    expect(dueInfo(undefined, TODAY)).toBeNull();
    expect(dueInfo("", TODAY)).toBeNull();
  });

  it("gives a short date and the days left", () => {
    expect(dueInfo("2030-11-01", TODAY)).toMatchObject({ short: "Nov 1", rel: "31 days", days: 31 });
    expect(dueInfo("2030-10-02", TODAY)).toMatchObject({ rel: "1 day", days: 1 });
  });

  it("says today on the day, and passed from the next day", () => {
    expect(dueInfo(TODAY, TODAY)).toMatchObject({ rel: "today", tone: "soon" });
    expect(dueInfo("2030-09-30", TODAY)).toMatchObject({ rel: "passed", tone: "passed", days: -1 });
  });

  it("is red within 14 days, amber within 45, neutral after", () => {
    expect(SOON_DAYS).toBe(14);
    expect(NEAR_DAYS).toBe(45);
    expect(dueInfo("2030-10-15", TODAY)?.tone).toBe("soon"); // 14 days
    expect(dueInfo("2030-10-16", TODAY)?.tone).toBe("near"); // 15 days
    expect(dueInfo("2030-11-15", TODAY)?.tone).toBe("near"); // 45 days
    expect(dueInfo("2030-11-16", TODAY)?.tone).toBe("far"); // 46 days
  });

  it("does not shift the date across time zones", () => {
    expect(dueInfo("2031-01-01", TODAY)?.short).toBe("Jan 1");
    expect(dueInfo("2030-12-31", TODAY)?.short).toBe("Dec 31");
  });
});

describe("localISODate", () => {
  it("uses the device's calendar day", () => {
    expect(localISODate(new Date(2030, 0, 5, 23, 30))).toBe("2030-01-05");
    expect(localISODate(new Date(2030, 11, 31, 0, 1))).toBe("2030-12-31");
  });
});
