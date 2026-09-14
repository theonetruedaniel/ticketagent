import {
  stableListingId,
  type NormalizedListing,
  type ScanBatch
} from "@ticket-agent/contracts";

type JsonObject = Record<string, unknown>;

type StubHubEvent = {
  sourceEventId: string;
  mlbGamePk: string;
  eventName: string;
  eventDate: string;
  venue: string;
};

let tokenCache: { value: string; expiresAt: number } | null = null;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function text(...values: unknown[]): string | null {
  const value = first(...values);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function number(...values: unknown[]): number | null {
  const value = first(...values);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function embeddedListings(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = object(payload);
  const embedded = object(root._embedded);
  for (const candidate of [
    root.listings,
    root.items,
    embedded.listings,
    embedded.items,
    embedded.tickets
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function linkFor(listing: JsonObject, fallback: string): string {
  const links = object(listing._links);
  for (const candidate of [links.webpage, links.web, links.self]) {
    const href = text(object(candidate).href, candidate);
    if (href?.startsWith("http")) return href;
  }
  return fallback;
}

function allInPrice(listing: JsonObject): number | null {
  const price = object(listing.price);
  const ticketPrice = object(listing.ticket_price);
  return number(
    listing.allInPrice,
    listing.all_in_price,
    listing.priceWithFees,
    listing.price_with_fees,
    price.allIn,
    price.all_in,
    price.withFees,
    price.with_fees,
    ticketPrice.allIn,
    ticketPrice.all_in,
    ticketPrice.withFees,
    ticketPrice.with_fees
  );
}

export function normalizeStubHubListings(
  payload: unknown,
  event: StubHubEvent,
  pageUrl: string,
  observedAt = new Date().toISOString()
): { listings: NormalizedListing[]; skippedWithoutAllInPrice: number } {
  let skippedWithoutAllInPrice = 0;
  const listings = embeddedListings(payload).flatMap((raw) => {
    const item = object(raw);
    const seating = object(first(item.seating, item.display_seating));
    const pricePerTicket = allInPrice(item);
    if (!pricePerTicket) {
      skippedWithoutAllInPrice += 1;
      return [];
    }
    const section = text(
      seating.section,
      item.section,
      item.section_name,
      item.zone,
      item.zone_name
    );
    if (!section) return [];
    const quantity = number(
      item.quantity,
      item.numberOfTickets,
      item.number_of_tickets,
      item.display_number_of_tickets
    );
    const quantityMin = Math.max(1, Math.floor(number(
      item.minQuantity,
      item.min_quantity,
      item.minimum_purchase_quantity,
      1
    ) ?? 1));
    const quantityMax = Math.max(
      quantityMin,
      Math.floor(number(item.maxQuantity, item.max_quantity, quantity) ?? quantityMin)
    );
    const nativeId = text(item.id, item.listingId, item.listing_id);
    const deepLink = linkFor(item, pageUrl);
    const row = text(seating.row, item.row, item.row_label);
    const seatFrom = text(seating.seatFrom, seating.seat_from, item.seat_from);
    const seatTo = text(seating.seatTo, seating.seat_to, item.seat_to);
    const listingId = stableListingId({
      source: "StubHub",
      sourceEventId: event.sourceEventId,
      nativeId,
      section,
      row,
      seatFrom,
      seatTo,
      quantityMin,
      quantityMax,
      pricePerTicket,
      deepLink
    });
    return [{
      source: "StubHub" as const,
      sourceEventId: event.sourceEventId,
      listingId,
      mlbGamePk: event.mlbGamePk,
      observedAt,
      scanId: "stubhub-pending",
      scanCompleteness: "full" as const,
      eventName: event.eventName,
      eventDate: event.eventDate,
      venue: event.venue,
      section,
      row,
      seatFrom,
      seatTo,
      quantityMin,
      quantityMax,
      pricePerTicket,
      currency: text(
        object(item.price).currency,
        object(item.ticket_price).currency,
        item.currency
      ) ?? "USD",
      allIn: true,
      collectionMode: "official_api" as const,
      priceBasis: "all_in" as const,
      providerObservedAt: text(item.updated_at, item.updatedAt, item.last_modified) ?? observedAt,
      accessible: Boolean(first(item.accessible, seating.accessible, false)),
      limitedView: Boolean(first(item.limited_view, item.limitedView, false)),
      notes: [],
      deepLink
    }];
  });
  return { listings, skippedWithoutAllInPrice };
}

async function applicationToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const clientId = process.env.STUBHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.STUBHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("StubHub client credentials are not configured");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: process.env.STUBHUB_SCOPE?.trim() || "read:events"
  });
  const response = await fetch("https://account.stubhub.com/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`StubHub OAuth returned ${response.status}`);
  }
  const payload = object(await response.json());
  const value = text(payload.access_token);
  if (!value) throw new Error("StubHub OAuth response did not include an access token");
  const expiresIn = number(payload.expires_in) ?? 3600;
  tokenCache = { value, expiresAt: Date.now() + expiresIn * 1000 };
  return value;
}

export function stubHubCollectionCapability() {
  const credentials = Boolean(
    process.env.STUBHUB_CLIENT_ID?.trim() &&
    process.env.STUBHUB_CLIENT_SECRET?.trim()
  );
  const template = process.env.STUBHUB_LISTINGS_URL_TEMPLATE?.trim() ?? "";
  return {
    configured: credentials && template.includes("{eventId}"),
    credentials,
    listingsEndpoint: template.includes("{eventId}"),
    collectionMode: credentials && template.includes("{eventId}")
      ? "official_api" as const
      : "access_pending" as const
  };
}

export async function collectStubHubEvent(
  event: StubHubEvent
): Promise<ScanBatch & { skippedWithoutAllInPrice: number }> {
  const template = process.env.STUBHUB_LISTINGS_URL_TEMPLATE?.trim() ?? "";
  if (!template.includes("{eventId}")) {
    throw new Error("STUBHUB_LISTINGS_URL_TEMPLATE must contain {eventId}");
  }
  const pageUrl = template.replace("{eventId}", encodeURIComponent(event.sourceEventId));
  const token = await applicationToken();
  const startedAt = new Date().toISOString();
  const response = await fetch(pageUrl, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error(`StubHub listings returned ${response.status}`);
  }
  const completedAt = new Date().toISOString();
  const normalized = normalizeStubHubListings(
    await response.json(),
    event,
    pageUrl,
    completedAt
  );
  const scanId = crypto.randomUUID();
  return {
    scanId,
    source: "StubHub",
    sourceEventId: event.sourceEventId,
    completeness: "full",
    startedAt,
    completedAt,
    pageUrl,
    extensionVersion: "stubhub-official-api-v1",
    collectionMode: "official_api",
    status: "complete",
    statusMessage: normalized.skippedWithoutAllInPrice
      ? `${normalized.skippedWithoutAllInPrice} records omitted because an all-in price was not explicit`
      : null,
    listings: normalized.listings.map((listing) => ({ ...listing, scanId })),
    skippedWithoutAllInPrice: normalized.skippedWithoutAllInPrice
  };
}
