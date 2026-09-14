import { describe, expect, it } from "vitest";
import { systemAlertDeliveryEligible } from "./delivery-eligibility";

const listing = {
  source: "SeatGeek",
  sourceEventId: "event-1",
  listingId: "listing-1",
  mlbGamePk: null,
  observedAt: "2026-07-29T12:00:00.000Z",
  scanId: "scan-12345678",
  scanCompleteness: "full",
  eventName: "New York Mets at Atlanta Braves",
  eventDate: "2026-07-29T23:20:00.000Z",
  venue: "Truist Park",
  section: "116",
  row: "8",
  seatFrom: null,
  seatTo: null,
  quantityMin: 1,
  quantityMax: 2,
  pricePerTicket: 60,
  currency: "USD",
  allIn: true,
  collectionMode: "connector_alert",
  priceBasis: "all_in",
  accessible: false,
  limitedView: false,
  notes: [],
  deepLink: "https://seatgeek.com/example"
};

describe("system alert delivery safety gate", () => {
  it("rejects 300- and 400-level standard alerts", () => {
    expect(systemAlertDeliveryEligible({
      listing: { ...listing, section: "315" },
      type: "price"
    })).toBe(false);
    expect(systemAlertDeliveryEligible({
      listing: { ...listing, section: "416" },
      type: "newListing"
    })).toBe(false);
    expect(systemAlertDeliveryEligible({
      listing: { ...listing, section: "122" },
      type: "price"
    })).toBe(true);
  });

  it("rejects section 211 even when it was incorrectly queued as an infield deal", () => {
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "211", pricePerTicket: 28.96 }
    })).toBe(false);
    expect(systemAlertDeliveryEligible({
      priority: true,
      listing: {
        ...listing,
        section: "Xfinity Club 211",
        pricePerTicket: 20
      }
    })).toBe(false);
  });

  it("accepts only the established lower and 200-level ranges at their thresholds", () => {
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "116", pricePerTicket: 60 }
    })).toBe(true);
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "216", pricePerTicket: 40 }
    })).toBe(true);
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "216", pricePerTicket: 40.01 }
    })).toBe(false);
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "235", pricePerTicket: 40 }
    })).toBe(true);
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: { ...listing, section: "236", pricePerTicket: 10 }
    })).toBe(false);
  });

  it("allows the Xfinity exception up to $60 within the established range", () => {
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: {
        ...listing,
        section: "Xfinity Club 218",
        pricePerTicket: 60
      }
    })).toBe(true);
  });

  it("rejects pre-fee system alerts even when section and price match", () => {
    expect(systemAlertDeliveryEligible({
      infieldDeal: true,
      listing: {
        ...listing,
        section: "118",
        pricePerTicket: 20,
        allIn: false
      }
    })).toBe(false);
  });
});
