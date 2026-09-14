import { describe, expect, it } from "vitest";
import {
  adaptiveScanIntervalMinutes,
  alertCooldownKey,
  alertMatchesListing,
  crossPlatformMappingFeedSchema,
  dealScore,
  emailRetryState,
  escapeHtml,
  freshnessState,
  isScanDue,
  isBravesHomeEvent,
  isAlertSectionAllowed,
  isInfieldDealListing,
  isPriorityClubListing,
  browserPurchaseQuantities,
  listingCanFulfillQuantity,
  listingIdsToRetire,
  matchCanonicalBravesEvent,
  normalizedListingSchema,
  stableListingId
} from "./index";

describe("marketplace scheduling and mapping contracts", () => {
  const now = "2026-07-28T12:00:00.000Z";

  it("increases scan frequency as an event approaches", () => {
    expect(adaptiveScanIntervalMinutes("2026-08-20T12:00:00.000Z", false, now)).toBe(360);
    expect(adaptiveScanIntervalMinutes("2026-08-02T12:00:00.000Z", false, now)).toBe(120);
    expect(adaptiveScanIntervalMinutes("2026-07-30T00:00:00.000Z", false, now)).toBe(30);
    expect(adaptiveScanIntervalMinutes("2026-07-29T00:00:00.000Z", false, now)).toBe(15);
    expect(adaptiveScanIntervalMinutes("2026-08-20T12:00:00.000Z", true, now)).toBe(5);
  });

  it("determines whether a source-event scan is due", () => {
    expect(isScanDue(null, 30, now)).toBe(true);
    expect(isScanDue("2026-07-28T11:20:00.000Z", 30, now)).toBe(true);
    expect(isScanDue("2026-07-28T11:45:00.000Z", 30, now)).toBe(false);
  });

  it("validates authorized cross-platform mapping feeds", () => {
    expect(crossPlatformMappingFeedSchema.parse([{
      mlbGamePk: "777001",
      sources: {
        SeatGeek: {
          sourceEventId: "17692717",
          url: "https://seatgeek.com/example"
        },
        StubHub: { sourceEventId: "159262152" }
      }
    }])).toHaveLength(1);
    expect(() => crossPlatformMappingFeedSchema.parse([{
      mlbGamePk: "777001",
      sources: {}
    }])).toThrow();
  });
});

const listing = {
  source: "SeatGeek" as const,
  sourceEventId: "17692707",
  listingId: "SeatGeek:123",
  mlbGamePk: null,
  observedAt: "2026-07-18T15:00:00.000Z",
  scanId: "scan-12345678",
  scanCompleteness: "full" as const,
  eventName: "San Diego Padres at Atlanta Braves",
  eventDate: "2026-07-20T23:15:00.000Z",
  venue: "Truist Park",
  section: "118",
  row: "19",
  seatFrom: "11",
  seatTo: "12",
  quantityMin: 2,
  quantityMax: 2,
  pricePerTicket: 23,
  currency: "USD",
  allIn: true,
  accessible: false,
  limitedView: false,
  notes: ["Aisle"],
  deepLink: "https://seatgeek.com/example"
};

describe("listing contract", () => {
  it("accepts a normalized all-in listing", () => {
    expect(normalizedListingSchema.parse(listing).pricePerTicket).toBe(23);
  });

  it("rejects inverted quantities", () => {
    expect(() => normalizedListingSchema.parse({ ...listing, quantityMin: 4, quantityMax: 2 })).toThrow();
  });
});

describe("domain behavior", () => {
  const baseAlert = {
    id: "alert-1",
    type: "price" as const,
    enabled: true,
    mlbGamePk: null,
    source: null,
    sectionQuery: null,
    quantity: 2,
    maxPrice: 25,
    accessible: null,
    emailEnabled: true
  };

  it("classifies source freshness", () => {
    const now = new Date("2026-07-18T16:00:00.000Z").getTime();
    expect(freshnessState("2026-07-18T15:50:01.000Z", now)).toBe("fresh");
    expect(freshnessState("2026-07-18T15:20:00.000Z", now)).toBe("aging");
    expect(freshnessState("2026-07-18T14:59:59.000Z", now)).toBe("stale");
  });

  it("scores a strong infield listing above a limited-view upper listing", () => {
    const strong = dealScore(listing, 65);
    const weak = dealScore({ ...listing, section: "433", pricePerTicket: 65, limitedView: true }, 65);
    expect(strong).toBeGreaterThan(weak);
  });

  it("builds stable derived identities", () => {
    const input = {
      source: listing.source,
      sourceEventId: listing.sourceEventId,
      section: listing.section,
      row: listing.row,
      seatFrom: listing.seatFrom,
      seatTo: listing.seatTo,
      quantityMin: listing.quantityMin,
      quantityMax: listing.quantityMax,
      pricePerTicket: listing.pricePerTicket,
      deepLink: listing.deepLink
    };
    expect(stableListingId(input)).toBe(stableListingId(input));
    expect(stableListingId(input)).toBe(stableListingId({
      ...input,
      pricePerTicket: 15,
      quantityMin: 1,
      quantityMax: 1
    }));
    expect(stableListingId(input)).not.toBe(stableListingId({
      ...input,
      seatTo: "14"
    }));
  });

  it("matches threshold, new-listing, and price-drop alerts consistently", () => {
    expect(alertMatchesListing(baseAlert, listing, { isNew: false })).toBe(true);
    expect(alertMatchesListing({ ...baseAlert, maxPrice: 20 }, listing, { isNew: false })).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, type: "newListing", maxPrice: null },
      listing,
      { isNew: true }
    )).toBe(true);
    expect(alertMatchesListing(
      { ...baseAlert, type: "priceDrop", maxPrice: null },
      listing,
      { isNew: false, previousPrice: 31 }
    )).toBe(true);
    expect(alertMatchesListing(
      { ...baseAlert, type: "priceDrop", maxPrice: 20 },
      listing,
      { isNew: false, previousPrice: 31 }
    )).toBe(false);
  });

  it("requires the requested quantity to fall inside the purchase range", () => {
    expect(listingCanFulfillQuantity(listing, 1)).toBe(false);
    expect(listingCanFulfillQuantity(listing, 2)).toBe(true);
    expect(listingCanFulfillQuantity({ ...listing, quantityMin: 1, quantityMax: 2 }, 1)).toBe(true);
    expect(alertMatchesListing(
      { ...baseAlert, quantity: 1 },
      listing,
      { isNew: false }
    )).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, quantity: 1 },
      { ...listing, quantityMin: 1, quantityMax: 2 },
      { isNew: false }
    )).toBe(true);
  });

  it("runs active browser quantity passes only for GameTime and TickPick", () => {
    expect(browserPurchaseQuantities("GameTime")).toEqual([1, 2]);
    expect(browserPurchaseQuantities("TickPick")).toEqual([1, 2]);
    expect(browserPurchaseQuantities("SeatGeek")).toEqual([1, 2]);
    expect(browserPurchaseQuantities("StubHub")).toEqual([1, 2]);
  });

  it("applies source, section, quantity, accessibility, and enabled filters", () => {
    expect(alertMatchesListing(
      {
        ...baseAlert,
        source: "StubHub",
        sectionQuery: "118",
        quantity: 2
      },
      listing,
      { isNew: false }
    )).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, accessible: true },
      listing,
      { isNew: false }
    )).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, enabled: false },
      listing,
      { isNew: false }
    )).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, quantity: 1 },
      { ...listing, section: "315", quantityMin: 1, quantityMax: 1 },
      { isNew: true }
    )).toBe(false);
    expect(alertMatchesListing(
      { ...baseAlert, quantity: 1 },
      { ...listing, section: "416", quantityMin: 1, quantityMax: 1 },
      { isNew: true }
    )).toBe(false);
  });

  it("keeps every alert inside the established 116-135 and 216-235 zones", () => {
    expect(isAlertSectionAllowed("Delta Club 122")).toBe(true);
    expect(isAlertSectionAllowed("Xfinity Club 218")).toBe(true);
    expect(isAlertSectionAllowed("Section 315")).toBe(false);
    expect(isAlertSectionAllowed("Section 416")).toBe(false);
    expect(isAlertSectionAllowed("General Admission")).toBe(false);
  });

  it("prioritizes Xfinity at $60 and Delta Club sections 122-130 at $100", () => {
    expect(isPriorityClubListing({
      ...listing,
      section: "Xfinity Club 218",
      quantityMin: 1,
      quantityMax: 1,
      pricePerTicket: 60
    })).toBe(true);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta SKY360 Club 122",
      quantityMin: 2,
      quantityMax: 4,
      pricePerTicket: 100
    })).toBe(true);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta SKY360 Club 130",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 100.01
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta Club 131",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 75
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta Club 122",
      quantityMin: 3,
      quantityMax: 4,
      pricePerTicket: 50
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Xfinity Club 218",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 60.01
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta Suite",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 40
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta Club 220",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 50
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Xfinity Club 211",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 20
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Xfinity Club",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 20
    })).toBe(false);
    expect(isPriorityClubListing({
      ...listing,
      section: "Delta SKY360 Club 122",
      allIn: false,
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 20
    })).toBe(false);
  });

  it("uses $100 for Delta 122-130, $60 for other 100s, and $40 for non-Xfinity 200s", () => {
    expect(isInfieldDealListing({
      ...listing,
      section: "Section 116",
      quantityMin: 1,
      quantityMax: 2,
      pricePerTicket: 60
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "135",
      quantityMin: 2,
      quantityMax: 4,
      pricePerTicket: 55
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "Delta SKY360 Club 126",
      pricePerTicket: 100
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "Section 126",
      pricePerTicket: 60.01
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "216",
      pricePerTicket: 40
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "235",
      pricePerTicket: 40
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "216",
      pricePerTicket: 40.01
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "Xfinity Club 218",
      pricePerTicket: 60
    })).toBe(true);
    expect(isInfieldDealListing({
      ...listing,
      section: "115",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "137",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "211",
      pricePerTicket: 28.96
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "215",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "237",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "315",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "426",
      pricePerTicket: 40
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "118",
      pricePerTicket: 60.01
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "118",
      pricePerTicket: 45,
      limitedView: true
    })).toBe(false);
    expect(isInfieldDealListing({
      ...listing,
      section: "118",
      allIn: false,
      pricePerTicket: 45
    })).toBe(false);
  });

  it("retires listings only after a completed full scan", () => {
    const current = ["a", "b", "c"];
    expect(listingIdsToRetire(current, ["a", "c"], "partial", "partial")).toEqual([]);
    expect(listingIdsToRetire(current, ["a", "c"], "full", "blocked")).toEqual([]);
    expect(listingIdsToRetire(current, ["a", "c"], "full", "complete")).toEqual(["b"]);
  });

  it("uses stable 15-minute alert cooldown buckets", () => {
    const first = alertCooldownKey("rule", "SeatGeek", "listing", "2026-07-18T15:01:00.000Z");
    const sameBucket = alertCooldownKey("rule", "SeatGeek", "listing", "2026-07-18T15:14:59.000Z");
    const nextBucket = alertCooldownKey("rule", "SeatGeek", "listing", "2026-07-18T15:15:00.000Z");
    expect(first).toBe(sameBucket);
    expect(first).not.toBe(nextBucket);
  });

  it("escapes marketplace text before including it in alert email HTML", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)"> & seats')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; seats"
    );
  });

  it("backs off mocked email failures and stops after five attempts", () => {
    expect(emailRetryState(0, "2026-07-18T15:00:00.000Z")).toEqual({
      attempts: 1,
      status: "pending",
      nextAttemptAt: "2026-07-18T15:02:00.000Z"
    });
    expect(emailRetryState(4, "2026-07-18T15:00:00.000Z")).toEqual({
      attempts: 5,
      status: "failed",
      nextAttemptAt: "2026-07-18T15:32:00.000Z"
    });
  });

  it("recognizes Braves home events only at Truist Park", () => {
    expect(isBravesHomeEvent("Padres at Atlanta Braves", "Truist Park")).toBe(true);
    expect(isBravesHomeEvent("Atlanta Braves at Padres", "Petco Park")).toBe(false);
  });

  it("matches canonical games using venue, opponent, and start time", () => {
    expect(matchCanonicalBravesEvent(listing, [
      {
        id: "wrong",
        mlbGamePk: "100",
        opponent: "Philadelphia Phillies",
        startsAt: "2026-07-20T23:15:00.000Z",
        venue: "Truist Park"
      },
      {
        id: "right",
        mlbGamePk: "101",
        opponent: "San Diego Padres",
        startsAt: "2026-07-20T23:20:00.000Z",
        venue: "Truist Park"
      }
    ])?.id).toBe("right");
  });

  it("does not guess a game when opponent evidence is missing", () => {
    expect(matchCanonicalBravesEvent(
      { ...listing, eventName: "Atlanta Braves home game" },
      [{
        id: "ambiguous",
        mlbGamePk: "101",
        opponent: "San Diego Padres",
        startsAt: "2026-07-20T23:20:00.000Z",
        venue: "Truist Park"
      }]
    )).toBeNull();
  });
});
