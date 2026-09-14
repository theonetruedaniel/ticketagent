import type { AlertRule, NormalizedListing } from "@ticket-agent/contracts";

export interface DashboardEvent {
  id: string;
  mlbGamePk: string;
  opponent: string;
  startsAt: string;
  venue: string;
  inventoryCount: number;
  minimumPrice: number | null;
  trendPercent: number | null;
  freshness: Record<string, string | null>;
}

export interface DashboardHistoryPoint {
  source: NormalizedListing["source"];
  listingId: string;
  observedAt: string;
  pricePerTicket: number;
}

const now = Date.now();

export const demoEvents: DashboardEvent[] = [
  {
    id: "demo-mets",
    mlbGamePk: "746001",
    opponent: "New York Mets",
    startsAt: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    inventoryCount: 86,
    minimumPrice: 34,
    trendPercent: -8.4,
    freshness: {
      seatgeek: new Date(now - 4 * 60_000).toISOString(),
      stubhub: new Date(now - 22 * 60_000).toISOString(),
      tickpick: new Date(now - 7 * 60_000).toISOString(),
      gametime: new Date(now - 72 * 60_000).toISOString()
    }
  },
  {
    id: "demo-phillies",
    mlbGamePk: "746002",
    opponent: "Philadelphia Phillies",
    startsAt: new Date(now + 8 * 86_400_000).toISOString(),
    venue: "Truist Park",
    inventoryCount: 121,
    minimumPrice: 29,
    trendPercent: 3.1,
    freshness: {
      seatgeek: new Date(now - 11 * 60_000).toISOString(),
      stubhub: new Date(now - 18 * 60_000).toISOString(),
      tickpick: new Date(now - 42 * 60_000).toISOString(),
      gametime: null
    }
  }
];

export const demoListings: NormalizedListing[] = [
  {
    source: "TickPick",
    sourceEventId: "tp-746001",
    listingId: "tp-122-chop",
    mlbGamePk: "746001",
    observedAt: new Date(now - 7 * 60_000).toISOString(),
    scanId: "demo-tp",
    scanCompleteness: "full",
    eventName: "New York Mets at Atlanta Braves",
    eventDate: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    section: "122",
    row: "8",
    seatFrom: "5",
    seatTo: "8",
    quantityMin: 2,
    quantityMax: 4,
    pricePerTicket: 78,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: false,
    notes: ["Aisle seats"],
    deepLink: "https://www.tickpick.com/"
  },
  {
    source: "StubHub",
    sourceEventId: "sh-746001",
    listingId: "sh-315-19",
    mlbGamePk: "746001",
    observedAt: new Date(now - 22 * 60_000).toISOString(),
    scanId: "demo-sh",
    scanCompleteness: "partial",
    eventName: "New York Mets at Atlanta Braves",
    eventDate: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    section: "315",
    row: "12",
    seatFrom: null,
    seatTo: null,
    quantityMin: 1,
    quantityMax: 4,
    pricePerTicket: 42,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: false,
    notes: [],
    deepLink: "https://www.stubhub.com/"
  },
  {
    source: "SeatGeek",
    sourceEventId: "sg-746001",
    listingId: "sg-142-3",
    mlbGamePk: "746001",
    observedAt: new Date(now - 4 * 60_000).toISOString(),
    scanId: "demo-sg",
    scanCompleteness: "partial",
    eventName: "New York Mets at Atlanta Braves",
    eventDate: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    section: "142",
    row: "3",
    seatFrom: null,
    seatTo: null,
    quantityMin: 2,
    quantityMax: 2,
    pricePerTicket: 93,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: false,
    notes: ["Home run porch"],
    deepLink: "https://seatgeek.com/"
  },
  {
    source: "GameTime",
    sourceEventId: "gt-746001",
    listingId: "gt-421-5",
    mlbGamePk: "746001",
    observedAt: new Date(now - 72 * 60_000).toISOString(),
    scanId: "demo-gt",
    scanCompleteness: "full",
    eventName: "New York Mets at Atlanta Braves",
    eventDate: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    section: "421",
    row: "15",
    seatFrom: null,
    seatTo: null,
    quantityMin: 2,
    quantityMax: 6,
    pricePerTicket: 34,
    currency: "USD",
    allIn: true,
    accessible: false,
    limitedView: true,
    notes: ["Limited view"],
    deepLink: "https://gametime.co/"
  },
  {
    source: "TickPick",
    sourceEventId: "tp-746001",
    listingId: "tp-delta-4",
    mlbGamePk: "746001",
    observedAt: new Date(now - 7 * 60_000).toISOString(),
    scanId: "demo-tp",
    scanCompleteness: "full",
    eventName: "New York Mets at Atlanta Braves",
    eventDate: new Date(now + 3 * 86_400_000).toISOString(),
    venue: "Truist Park",
    section: "Delta Club",
    row: "4",
    seatFrom: null,
    seatTo: null,
    quantityMin: 2,
    quantityMax: 2,
    pricePerTicket: 162,
    currency: "USD",
    allIn: true,
    accessible: true,
    limitedView: false,
    notes: ["Wheelchair accessible"],
    deepLink: "https://www.tickpick.com/"
  }
];

export const demoHistory: DashboardHistoryPoint[] = demoListings.flatMap((listing, index) =>
  [24, 12, 3, 0].map((hoursAgo, pointIndex) => ({
    source: listing.source,
    listingId: listing.listingId,
    observedAt: new Date(now - hoursAgo * 60 * 60_000).toISOString(),
    pricePerTicket: Math.max(
      8,
      listing.pricePerTicket + (3 - pointIndex) * (index % 2 === 0 ? 4 : -3)
    )
  }))
);

export const demoAlerts: AlertRule[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    type: "price",
    enabled: true,
    mlbGamePk: "746001",
    source: null,
    sectionQuery: "122",
    quantity: 2,
    maxPrice: 75,
    accessible: null,
    emailEnabled: true
  }
];
