import { describe, expect, it } from "vitest";
import { parseMarketplaceCard, type AdapterContext } from "./adapters";

const context: AdapterContext = {
  source: "SeatGeek",
  sourceEventId: "event-1",
  eventName: "Padres at Atlanta Braves",
  eventDate: "2026-07-20T23:15:00.000Z",
  venue: "Truist Park",
  pageUrl: "https://example.com/event-1",
  observedAt: "2026-07-18T15:00:00.000Z",
  scanId: "scan-12345678",
  scanCompleteness: "full"
};

describe("marketplace text adapters", () => {
  it("parses SeatGeek accessible labels", () => {
    const result = parseMarketplaceCard(
      "SeatGeek",
      "Section 110, Row 19, Seats 11-12, 2 tickets at $23 each, Deal Score 10, Instant delivery, incl. fees",
      context,
      "https://seatgeek.com/listing/1"
    );
    expect(result).toMatchObject({ section: "110", row: "19", quantityMin: 2, pricePerTicket: 23, allIn: true });
  });

  it("combines SeatGeek's live accessible label with rendered fee and seat text", () => {
    const result = parseMarketplaceCard(
      "SeatGeek",
      "Section 418, Row 8, 2 tickets at $11 each, Deal Score 10 Section 418 Row 8, Seats 3-4 $11 incl. fees",
      context,
      "https://seatgeek.com/mlb/17692706"
    );
    expect(result).toMatchObject({
      section: "418",
      row: "8",
      seatFrom: "3",
      seatTo: "4",
      quantityMin: 2,
      quantityMax: 2,
      pricePerTicket: 11,
      allIn: true
    });
  });

  it("parses TickPick cards", () => {
    const result = parseMarketplaceCard(
      "TickPick",
      "Section 426 Row 11 • 2 Tickets Budget Deal $10 ea All-in pricing",
      { ...context, source: "TickPick" },
      "https://tickpick.com/event/1"
    );
    expect(result).toMatchObject({ section: "426", row: "11", quantityMax: 2, pricePerTicket: 10, allIn: true });
  });

  it("parses the current TickPick card quantity range and all-in price", () => {
    const listing = parseMarketplaceCard(
      "TickPick",
      "Buy tickets for Section 413, Row 10, Quantity 1-7 Tickets Section 413 Row 10 • 1-7 Tickets Budget Deal $17 ea",
      { ...context, source: "TickPick", requestedQuantity: 2 },
      "https://www.tickpick.com/buy-event/7368071/"
    );

    expect(listing).toMatchObject({
      section: "413",
      row: "10",
      quantityMin: 1,
      quantityMax: 7,
      pricePerTicket: 17,
      allIn: true
    });
  });

  it("parses GameTime cards", () => {
    const result = parseMarketplaceCard(
      "GameTime",
      "Seat view from Grandstand Infield Amazing Deal Grandstand Infield 430, Row 2 Top 5% Value Includes Fees $12/ea 2 Tickets",
      { ...context, source: "GameTime" },
      "https://gametime.co/events/1/listings/abc",
      "abc"
    );
    expect(result).toMatchObject({ section: "430", row: "2", pricePerTicket: 12, allIn: true });
  });

  it("uses the selected browser quantity when a card omits quantity", () => {
    const single = parseMarketplaceCard(
      "GameTime",
      "Grandstand Corner 412, Row 10 Includes Fees $17/ea",
      { ...context, source: "GameTime", requestedQuantity: 1 },
      "https://gametime.co/events/1/listings/shared",
      "shared"
    );
    const pair = parseMarketplaceCard(
      "GameTime",
      "Grandstand Corner 412, Row 10 Includes Fees $17/ea",
      { ...context, source: "GameTime", requestedQuantity: 2 },
      "https://gametime.co/events/1/listings/shared",
      "shared"
    );
    expect(single).toMatchObject({ quantityMin: 1, quantityMax: 1 });
    expect(pair).toMatchObject({ quantityMin: 2, quantityMax: 2 });
    expect(single?.listingId).not.toBe(pair?.listingId);

    const derivedSingle = parseMarketplaceCard(
      "GameTime",
      "Grandstand Corner 412, Row 10 Includes Fees $17/ea",
      { ...context, source: "GameTime", requestedQuantity: 1 },
      "https://gametime.co/events/1"
    );
    const derivedPair = parseMarketplaceCard(
      "GameTime",
      "Grandstand Corner 412, Row 10 Includes Fees $17/ea",
      { ...context, source: "GameTime", requestedQuantity: 2 },
      "https://gametime.co/events/1"
    );
    expect(derivedSingle?.listingId).not.toBe(derivedPair?.listingId);
  });

  it("preserves an explicit flexible provider range", () => {
    const result = parseMarketplaceCard(
      "SeatGeek",
      "Section 110, Row 19, 1-4 tickets at $30 each, incl. fees",
      { ...context, requestedQuantity: 1 },
      "https://seatgeek.com/listing/flexible",
      "flexible"
    );
    expect(result).toMatchObject({ quantityMin: 1, quantityMax: 4 });
    expect(result?.listingId).toBe("SeatGeek:flexible");
  });

  it("parses GameTime cards when adjacent DOM elements remove spaces", () => {
    const result = parseMarketplaceCard(
      "GameTime",
      "Seat view from section Grandstand Infield118, Row 6Top 5% Value Includes Fees$142/ea 2 Tickets",
      { ...context, source: "GameTime" },
      "https://gametime.co/events/1/listings/jammed",
      "jammed"
    );
    expect(result).toMatchObject({
      section: "118",
      row: "6",
      pricePerTicket: 142,
      quantityMax: 2
    });

    const corner = parseMarketplaceCard(
      "GameTime",
      "Terrace Corner210, Row 12Includes Fees$31/ea 2 Tickets",
      { ...context, source: "GameTime" },
      "https://gametime.co/events/1/listings/corner",
      "corner"
    );
    expect(corner).toMatchObject({ section: "210", row: "12", pricePerTicket: 31 });
  });

  it("parses StubHub cards after non-semantic wrapper changes", () => {
    const result = parseMarketplaceCard(
      "StubHub",
      "2 tickets Section 123 Row 7 Seats 5-6 $44 each Prices include fees",
      { ...context, source: "StubHub" },
      "https://www.stubhub.com/event/1/listing/xyz",
      "xyz"
    );
    expect(result).toMatchObject({
      section: "123",
      row: "7",
      quantityMin: 2,
      pricePerTicket: 44,
      allIn: true
    });
  });

  it("uses StubHub's fee-inclusive current price instead of a crossed-out price", () => {
    const result = parseMarketplaceCard(
      "StubHub",
      "Section 429 Row 4 Seats 5-6 2 tickets Only 2 left $26 Now $14 incl. fees",
      { ...context, source: "StubHub" },
      "https://www.stubhub.com/event/1/listing/discount",
      "discount"
    );
    expect(result).toMatchObject({ section: "429", pricePerTicket: 14, allIn: true });
  });

  it("parses the current StubHub listing button without duplicating its section", () => {
    const result = parseMarketplaceCard(
      "StubHub",
      "Truist Park - Section 438 Section 438 Row 2 2 tickets together Clear view Second Row of Section Best price $25 Now $15 incl. fees 9.3 Amazing",
      { ...context, source: "StubHub" },
      "https://www.stubhub.com/event/159262147/listing/example"
    );
    expect(result).toMatchObject({
      section: "438",
      row: "2",
      quantityMin: 2,
      quantityMax: 2,
      pricePerTicket: 15,
      allIn: true
    });
  });

  it("rejects cards with missing price or section fields", () => {
    expect(parseMarketplaceCard(
      "SeatGeek",
      "Section 110 Row 2 two tickets",
      context,
      "https://seatgeek.com/listing/missing-price"
    )).toBeNull();
    expect(parseMarketplaceCard(
      "GameTime",
      "Two tickets for $40 each including fees",
      { ...context, source: "GameTime" },
      "https://gametime.co/events/1/listings/missing-section"
    )).toBeNull();
  });

  it("returns null for non-listing text", () => {
    expect(parseMarketplaceCard("StubHub", "Atlanta Braves tickets", { ...context, source: "StubHub" }, "https://stubhub.com")).toBeNull();
  });
});
