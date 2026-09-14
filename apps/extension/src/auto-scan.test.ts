import { describe, expect, it } from "vitest";
import {
  BACKGROUND_RESCAN_MS,
  NEXT_GAME_RESCAN_MS,
  PRIORITY_RESCAN_MS,
  autoScanJobKey,
  jobCadenceMs,
  selectAutoScanJobs
} from "./auto-scan";
import type { AutoScanJob } from "./types";
import {
  matchesQuantityOptionLabel,
  quantityPassesForSource
} from "./quantity-controls";

const NOW = Date.parse("2026-07-18T16:00:00.000Z");
const jobs: AutoScanJob[] = [
  {
    source: "SeatGeek",
    sourceEventId: "sg-next",
    url: "https://seatgeek.com/next",
    mlbGamePk: "1",
    opponent: "Rangers",
    startsAt: "2026-07-19T17:35:00.000Z",
    priority: false
  },
  {
    source: "StubHub",
    sourceEventId: "sh-next",
    url: "https://www.stubhub.com/next",
    mlbGamePk: "1",
    opponent: "Rangers",
    startsAt: "2026-07-19T17:35:00.000Z",
    priority: false
  },
  {
    source: "GameTime",
    sourceEventId: "gt-alert",
    url: "https://gametime.co/alert",
    mlbGamePk: "2",
    opponent: "Padres",
    startsAt: "2026-07-20T23:15:00.000Z",
    priority: true
  },
  {
    source: "TickPick",
    sourceEventId: "tp-future",
    url: "https://www.tickpick.com/future",
    mlbGamePk: "3",
    opponent: "Nationals",
    startsAt: "2026-07-30T23:15:00.000Z",
    priority: false
  }
];

describe("automatic scan scheduling", () => {
  it("uses fast cadence for alert games, then next game, then background inventory", () => {
    expect(jobCadenceMs(jobs[2]!, "1")).toBe(PRIORITY_RESCAN_MS);
    expect(jobCadenceMs(jobs[0]!, "1")).toBe(NEXT_GAME_RESCAN_MS);
    expect(jobCadenceMs(jobs[3]!, "1")).toBe(BACKGROUND_RESCAN_MS);
  });

  it("prioritizes an alert-covered game even when it starts later", () => {
    const selected = selectAutoScanJobs(jobs, {}, NOW, 2);
    expect(selected.map(autoScanJobKey)).toEqual([
      "GameTime:gt-alert",
      "SeatGeek:sg-next"
    ]);
  });

  it("does not select jobs that are not due", () => {
    const lastScannedAt = Object.fromEntries(
      jobs.map((job) => [autoScanJobKey(job), NOW])
    );
    expect(selectAutoScanJobs(jobs, lastScannedAt, NOW, 4)).toEqual([]);
  });

  it("uses exact single and pair passes for every enabled browser source", () => {
    expect(quantityPassesForSource("GameTime")).toEqual([1, 2]);
    expect(quantityPassesForSource("TickPick")).toEqual([1, 2]);
    expect(quantityPassesForSource("SeatGeek")).toEqual([1, 2]);
    expect(quantityPassesForSource("StubHub")).toEqual([1, 2]);
    expect(matchesQuantityOptionLabel("1 Ticket", 1)).toBe(true);
    expect(matchesQuantityOptionLabel("Select 2 Tickets", 2)).toBe(true);
  });
});
