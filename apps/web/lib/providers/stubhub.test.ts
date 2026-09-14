import { describe, expect, it } from "vitest";
import { normalizeStubHubListings } from "./stubhub";

const event = {
  sourceEventId: "1234",
  mlbGamePk: "777",
  eventName: "Miami Marlins at Atlanta Braves",
  eventDate: "2026-08-01T23:15:00.000Z",
  venue: "Truist Park"
};

describe("normalizeStubHubListings", () => {
  it("keeps only explicitly all-in prices", () => {
    const normalized = normalizeStubHubListings({
      _embedded: {
        listings: [
          {
            id: "listing-1",
            seating: { section: "118", row: "4" },
            quantity: 2,
            price: { all_in: 84.5, currency: "USD" },
            _links: { webpage: { href: "https://www.stubhub.com/example" } }
          },
          {
            id: "listing-2",
            seating: { section: "120", row: "8" },
            quantity: 4,
            price: { amount: 40, currency: "USD" }
          }
        ]
      }
    }, event, "https://api.stubhub.net/example", "2026-07-28T12:00:00.000Z");

    expect(normalized.skippedWithoutAllInPrice).toBe(1);
    expect(normalized.listings).toHaveLength(1);
    expect(normalized.listings[0]).toMatchObject({
      source: "StubHub",
      pricePerTicket: 84.5,
      allIn: true,
      priceBasis: "all_in",
      collectionMode: "official_api"
    });
  });

  it("preserves single, pair-only, and flexible purchase ranges", () => {
    const normalized = normalizeStubHubListings({
      listings: [
        {
          id: "single",
          section: "118",
          minQuantity: 1,
          maxQuantity: 1,
          allInPrice: 50
        },
        {
          id: "pair",
          section: "120",
          minQuantity: 2,
          maxQuantity: 2,
          allInPrice: 40
        },
        {
          id: "flex",
          section: "122",
          minQuantity: 1,
          maxQuantity: 4,
          allInPrice: 60
        }
      ]
    }, event, "https://api.stubhub.net/example", "2026-07-28T12:00:00.000Z");

    expect(normalized.listings.map((listing) => [
      listing.quantityMin,
      listing.quantityMax
    ])).toEqual([[1, 1], [2, 2], [1, 4]]);
  });
});
