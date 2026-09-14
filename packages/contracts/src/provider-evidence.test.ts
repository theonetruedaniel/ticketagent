import { describe, expect, it } from "vitest";
import { extractProviderEvidenceCandidates } from "./provider-evidence";

const observedAt = "2026-07-30T20:00:00.000Z";

describe("provider listing evidence", () => {
  it("accepts SeatGeek only when priceWithFees and explicit quantity are present", () => {
    const candidates = extractProviderEvidenceCandidates(
      "SeatGeek",
      {
        listings: [
          {
            id: "sg-verified",
            section: "118",
            row: "7",
            minQuantity: 1,
            maxQuantity: 4,
            price: 25,
            priceWithFees: 31.45,
            url: "/listing/sg-verified"
          },
          {
            id: "sg-before-fees",
            section: "119",
            row: "8",
            quantity: 2,
            price: 20
          },
          {
            id: "sg-no-quantity",
            section: "120",
            row: "9",
            priceWithFees: 22
          }
        ]
      },
      "https://seatgeek.com/mlb/17692718",
      observedAt
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        nativeId: "sg-verified",
        section: "118",
        row: "7",
        quantityMin: 1,
        quantityMax: 4,
        pricePerTicket: 31.45,
        deepLink: "https://seatgeek.com/listing/sg-verified"
      })
    ]);
  });

  it("accepts StubHub only when the price qualifier explicitly includes fees", () => {
    const candidates = extractProviderEvidenceCandidates(
      "StubHub",
      {
        listings: [
          {
            listingId: "sh-verified",
            seating: { section: "221", row: "12" },
            minQuantity: 1,
            maxQuantity: 2,
            priceInfo: {
              amount: 38,
              currency: "USD",
              qualifier: { text: "incl. fees" }
            }
          },
          {
            listingId: "sh-unproven",
            seating: { section: "222", row: "13" },
            quantity: 2,
            priceInfo: { amount: 20, currency: "USD" }
          }
        ]
      },
      "https://www.stubhub.com/event/159262153",
      observedAt
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        nativeId: "sh-verified",
        section: "221",
        row: "12",
        quantityMin: 1,
        quantityMax: 2,
        pricePerTicket: 38
      })
    ]);
  });

  it("rejects summary prices, unsupported currencies, and unrelated sources", () => {
    expect(extractProviderEvidenceCandidates(
      "SeatGeek",
      { stats: { lowest_price: 12, listing_count: 100 } },
      "https://seatgeek.com/event",
      observedAt
    )).toEqual([]);
    expect(extractProviderEvidenceCandidates(
      "StubHub",
      {
        id: "eur",
        section: "118",
        quantity: 2,
        priceInfo: {
          amount: 30,
          currency: "EUR",
          qualifier: { text: "incl. fees" }
        }
      },
      "https://stubhub.com/event",
      observedAt
    )).toEqual([]);
    expect(extractProviderEvidenceCandidates(
      "GameTime",
      { id: "gt", section: "118", quantity: 2, priceWithFees: 30 },
      "https://gametime.co/event",
      observedAt
    )).toEqual([]);
  });
});
