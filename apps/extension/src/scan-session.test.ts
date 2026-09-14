import { describe, expect, it } from "vitest";
import type { NormalizedListing, ScanBatch } from "@ticket-agent/contracts";
import {
  ScanAccumulator,
  listingStorageKey,
  reconcileLocalListings
} from "./scan-session";
import {
  detectBlocker,
  hasExplicitEmptyInventory,
  isProgressControlLabel,
  isSuspiciousEmptyAccessPage
} from "./page-signals";

function listing(id: string, price = 40): NormalizedListing {
  return {
    source: "TickPick",
    sourceEventId: "event-1",
    listingId: id,
    mlbGamePk: "1",
    observedAt: "2026-07-18T12:00:00.000Z",
    scanId: "scan-virtualized",
    scanCompleteness: "full",
    eventName: "Mets at Atlanta Braves",
    eventDate: "2026-07-20T23:20:00.000Z",
    venue: "Truist Park",
    section: "122",
    row: "8",
    seatFrom: null,
    seatTo: null,
    quantityMin: 2,
    quantityMax: 4,
    pricePerTicket: price,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: false,
    notes: [],
    deepLink: `https://www.tickpick.com/listings/${id}`
  };
}

function batch(
  listings: NormalizedListing[],
  completeness: ScanBatch["completeness"] = "full",
  status: ScanBatch["status"] = "complete"
): ScanBatch {
  return {
    scanId: "scan-completed",
    source: "TickPick",
    sourceEventId: "event-1",
    completeness,
    startedAt: "2026-07-18T12:00:00.000Z",
    completedAt: "2026-07-18T12:01:00.000Z",
    pageUrl: "https://www.tickpick.com/braves/event-1",
    extensionVersion: "0.1.0",
    status,
    statusMessage: null,
    listings
  };
}

describe("full scan session", () => {
  it("retains cards that leave a virtualized viewport", () => {
    const scan = new ScanAccumulator();
    scan.add([listing("a"), listing("b")]);
    scan.add([listing("b"), listing("c")]);
    scan.add([listing("c"), listing("d")]);
    expect(scan.values().map((item) => item.listingId)).toEqual(["a", "b", "c", "d"]);
  });

  it("updates an already-seen listing without duplicating it", () => {
    const scan = new ScanAccumulator();
    scan.add([listing("a", 50)]);
    scan.add([listing("a", 42)]);
    expect(scan.values()).toHaveLength(1);
    expect(scan.values()[0]?.pricePerTicket).toBe(42);
  });

  it("requires repeated no-growth passes before completion", () => {
    const scan = new ScanAccumulator();
    scan.add([listing("a")]);
    scan.add([listing("a")]);
    scan.add([listing("a")]);
    expect(scan.stablePasses).toBe(2);
  });

  it("retires missing local inventory only after a completed full scan", () => {
    const existing = [listing("a"), listing("b")];
    expect(reconcileLocalListings(existing, batch([listing("a")])).map((item) => item.listingId))
      .toEqual(["a"]);
    expect(reconcileLocalListings(existing, batch([listing("a")], "partial", "partial")).map((item) => item.listingId))
      .toEqual(["a", "b"]);
    expect(reconcileLocalListings(existing, batch([], "full", "blocked")).map((item) => item.listingId))
      .toEqual(["a", "b"]);
  });

  it("does not retire listings from another event or marketplace", () => {
    const otherEvent = { ...listing("b"), sourceEventId: "event-2" };
    const otherSource = { ...listing("c"), source: "SeatGeek" as const };
    const reconciled = reconcileLocalListings(
      [listing("a"), otherEvent, otherSource],
      batch([])
    );
    expect(reconciled.map(listingStorageKey)).toEqual([
      listingStorageKey(otherEvent),
      listingStorageKey(otherSource)
    ]);
  });
});

describe("marketplace page signals", () => {
  it.each([
    ["Please verify you are human", "Bot or CAPTCHA challenge detected"],
    ["Just a moment... Enable JavaScript and cookies to continue", "Bot or CAPTCHA challenge detected"],
    ["Sign in to continue", "Marketplace login is required"],
    ["Access denied due to unusual traffic", "Marketplace access is blocked"],
    ["Pardon Our Interruption. Request unsuccessful.", "Marketplace access is blocked"]
  ])("recognizes blocking page %s", (text, expected) => {
    expect(detectBlocker(text)).toBe(expected);
  });

  it("recognizes pagination controls without matching unrelated buttons", () => {
    expect(isProgressControlLabel("Load more")).toBe(true);
    expect(isProgressControlLabel("Next page")).toBe(true);
    expect(isProgressControlLabel("Checkout")).toBe(false);
  });

  it("requires an explicit empty-inventory signal before treating zero cards as complete", () => {
    expect(hasExplicitEmptyInventory("No tickets available for this event")).toBe(true);
    expect(hasExplicitEmptyInventory("Choose your tickets")).toBe(false);
  });

  it("treats blank marketplace-brand 403 shells as blocked without confusing sold-out pages", () => {
    expect(isSuspiciousEmptyAccessPage("seatgeek.com", "", 0)).toBe(true);
    expect(isSuspiciousEmptyAccessPage("stubhub.com", "Request blocked", 0)).toBe(true);
    expect(isSuspiciousEmptyAccessPage("StubHub tickets for Braves", "No tickets available for this event", 0)).toBe(false);
    expect(isSuspiciousEmptyAccessPage("seatgeek.com", "", 2)).toBe(false);
  });
});
