import { describe, expect, it } from "vitest";
import { extractEmbeddedListingCandidates } from "./embedded-listings";

describe("embedded marketplace listing extraction", () => {
  it("extracts nested TickPick-style JSON listings", () => {
    const candidates = extractEmbeddedListingCandidates({
      event: {
        inventory: {
          listings: [{
            listingId: "tp-123",
            section: { name: "426" },
            rowName: "11",
            priceWithFees: { amount: 18 },
            availableQuantity: 4,
            listingUrl: "/buy/123"
          }]
        }
      }
    }, "https://www.tickpick.com/example/");

    expect(candidates).toEqual([{
      nativeId: "tp-123",
      deepLink: "https://www.tickpick.com/buy/123",
      text: "Section 426 Row 11 4 Tickets $18.00 ea"
    }]);
  });

  it("ignores event-level prices without a section", () => {
    expect(extractEmbeddedListingCandidates({
      event: { id: "event-1", lowestPrice: 12, name: "Nationals at Braves" }
    }, "https://www.tickpick.com/example/")).toEqual([]);
  });

  it("supports listings without a row", () => {
    expect(extractEmbeddedListingCandidates({
      id: "ga-1",
      sectionName: "General Admission",
      price: "$25",
      quantity: 2
    }, "https://www.tickpick.com/example/")[0]?.text).toBe(
      "Section General Admission, 2 Tickets $25.00 ea"
    );
  });

  it("preserves explicit provider purchase ranges", () => {
    expect(extractEmbeddedListingCandidates({
      listingId: "tp-flex",
      section: "430",
      row: "6",
      priceWithFees: 22,
      minQuantity: 1,
      maxQuantity: 4
    }, "https://www.tickpick.com/example/")[0]?.text).toBe(
      "Section 430 Row 6 1-4 Tickets $22.00 ea"
    );
  });
});
