import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@ticket-agent/contracts";
import { detectBlocker, mergeListings } from "./collector";
import {
  matchesQuantityOptionLabel,
  quantityPassesForSource
} from "./quantity-controls";

function listing(id: string, price: number): NormalizedListing {
  return {
    source: "GameTime",
    sourceEventId: "event-1",
    listingId: id,
    mlbGamePk: "1",
    observedAt: "2026-07-28T12:00:00.000Z",
    scanId: "scan-12345678",
    scanCompleteness: "full",
    eventName: "Mets at Atlanta Braves",
    eventDate: "2026-08-01T23:00:00.000Z",
    venue: "Truist Park",
    section: "118",
    row: null,
    seatFrom: null,
    seatTo: null,
    quantityMin: 2,
    quantityMax: 2,
    pricePerTicket: price,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: false,
    notes: [],
    deepLink: `https://gametime.co/events/1/listings/${id}`
  };
}

describe("worker collection helpers", () => {
  it("detects CAPTCHA and access blocks without trying to solve them", () => {
    expect(detectBlocker("Verify you are human")).toMatch(/CAPTCHA/);
    expect(detectBlocker("Access denied")).toMatch(/blocked/);
    expect(detectBlocker("Available listings")).toBeNull();
  });

  it("deduplicates observed listings and keeps the latest observation", () => {
    const values = new Map<string, NormalizedListing>();
    mergeListings(values, [listing("one", 80)]);
    mergeListings(values, [listing("one", 72), listing("two", 90)]);
    expect(values).toHaveLength(2);
    expect(values.get("GameTime:one")?.pricePerTicket).toBe(72);
  });

  it("configures exact single and pair passes for active browser sources", () => {
    expect(quantityPassesForSource("GameTime")).toEqual([1, 2]);
    expect(quantityPassesForSource("TickPick")).toEqual([1, 2]);
    expect(quantityPassesForSource("SeatGeek")).toEqual([1, 2]);
    expect(quantityPassesForSource("StubHub")).toEqual([1, 2]);
    expect(matchesQuantityOptionLabel("1 Ticket", 1)).toBe(true);
    expect(matchesQuantityOptionLabel("Select 2 tickets", 2)).toBe(true);
    expect(matchesQuantityOptionLabel("3 Tickets", 2)).toBe(false);
  });
});
