import {
  type MarketplaceSource,
  type NormalizedListing,
  stableListingId
} from "./index";

export type AdapterContext = {
  source: MarketplaceSource;
  sourceEventId: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  pageUrl: string;
  observedAt: string;
  scanId: string;
  scanCompleteness: "partial" | "full";
  requestedQuantity?: number;
};

type ParsedCard = {
  nativeId: string | null;
  section: string;
  row: string | null;
  seatFrom: string | null;
  seatTo: string | null;
  quantityMin: number;
  quantityMax: number;
  quantityExplicit: boolean;
  price: number;
  allIn: boolean;
  accessible: boolean;
  limitedView: boolean;
  notes: string[];
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function quantityRange(
  text: string,
  requestedQuantity?: number
): [number, number, boolean] {
  const range = text.match(/(\d+)\s*(?:-|\u2013|to)\s*(\d+)\s+tickets?/i);
  if (range) return [Number(range[1]), Number(range[2]), true];
  const exact = text.match(/(\d+)\s+tickets?/i);
  if (exact) return [Number(exact[1]), Number(exact[1]), true];
  const fallback = requestedQuantity ?? 1;
  return [fallback, fallback, false];
}

function sharedFlags(text: string) {
  const lower = text.toLowerCase();
  return {
    accessible: /(accessible|wheelchair|companion)/.test(lower),
    limitedView: /(limited view|obstructed|restricted view)/.test(lower),
    notes: [
      /aisle/.test(lower) ? "Aisle" : null,
      /front row/.test(lower) ? "Front row" : null,
      /instant delivery/.test(lower) ? "Instant delivery" : null,
      /(limited view|obstructed|restricted view)/.test(lower) ? "Limited view" : null,
      /(accessible|wheelchair)/.test(lower) ? "Accessible" : null
    ].filter((note): note is string => Boolean(note))
  };
}

function parseSeatGeek(text: string, requestedQuantity?: number): ParsedCard | null {
  const value = cleanText(text);
  const section = value.match(/(?:Section|Club)\s+([^,]+),\s*Row/i)?.[1]?.trim();
  const row = value.match(/Row\s+([^,]+),/i)?.[1]?.trim() ?? null;
  const seats = value.match(/Seats?\s+([A-Za-z0-9]+)(?:\s*[-\u2013]\s*([A-Za-z0-9]+))?/i);
  const price = numberFrom(value.match(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:each|incl\.?\s*fees)/i)?.[1]);
  if (!section || !price) return null;
  const [quantityMin, quantityMax, quantityExplicit] =
    quantityRange(value, requestedQuantity);
  return {
    nativeId: null,
    section,
    row,
    seatFrom: seats?.[1] ?? null,
    seatTo: seats?.[2] ?? null,
    quantityMin,
    quantityMax,
    quantityExplicit,
    price,
    allIn: /incl\.?\s*fees/i.test(value),
    ...sharedFlags(value)
  };
}

function parseTickPick(text: string, requestedQuantity?: number): ParsedCard | null {
  const value = cleanText(text);
  const section = value.match(/Section\s+([A-Za-z0-9 -]+?)(?=\s+Row\b|,|$)/i)?.[1]?.trim();
  const row = value.match(/Row\s+([A-Za-z0-9]+)/i)?.[1]?.trim() ?? null;
  const price = numberFrom(value.match(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:ea|each)/i)?.[1]);
  if (!section || !price) return null;
  const [quantityMin, quantityMax, quantityExplicit] =
    quantityRange(value, requestedQuantity);
  return {
    nativeId: null,
    section,
    row,
    seatFrom: null,
    seatTo: null,
    quantityMin,
    quantityMax,
    quantityExplicit,
    price,
    allIn: true,
    ...sharedFlags(value)
  };
}

function parseGameTime(text: string, requestedQuantity?: number): ParsedCard | null {
  const value = cleanText(text);
  const locationText = value.match(/([^,]+),\s*Row\s*/i)?.[1]?.trim() ?? "";
  const section =
    locationText.match(/(\d{2,3}[A-Za-z]?)\s*$/)?.[1]
    ?? locationText.match(/\b(GA)\s*$/i)?.[1]?.toUpperCase();
  const row = value.match(
    /Row\s*([A-Za-z0-9]+?)(?=\s*(?:Top\b|Includes?\s*Fees|Great\s*Deal|Amazing\s*Deal|Super\s*Deal|\$|Tickets?\b|$))/i
  )?.[1]?.trim() ?? null;
  const price = numberFrom(value.match(/\$([\d,]+(?:\.\d{1,2})?)\s*\/?\s*(?:ea|each)/i)?.[1]);
  if (!section || !price) return null;
  const [quantityMin, quantityMax, quantityExplicit] =
    quantityRange(value, requestedQuantity);
  return {
    nativeId: null,
    section,
    row,
    seatFrom: null,
    seatTo: null,
    quantityMin,
    quantityMax,
    quantityExplicit,
    price,
    allIn: /includes fees/i.test(value),
    ...sharedFlags(value)
  };
}

function parseStubHub(text: string, requestedQuantity?: number): ParsedCard | null {
  const value = cleanText(text);
  const section = value.match(/(?:Section|Sec)\s+([A-Za-z0-9-]+)\s+Row\b/i)?.[1]?.trim()
    ?? value.match(/(?:Section|Sec)\s+([A-Za-z0-9 -]+?)(?=\s+Row\b|,|\s+Seats?\b|\s+\$|$)/i)?.[1]?.trim()
    ?? value.match(/^([A-Za-z][A-Za-z ]+\s+\d{2,3})\b/)?.[1]?.trim();
  const row = value.match(/Row\s+([A-Za-z0-9]+)/i)?.[1]?.trim() ?? null;
  const price = numberFrom(
    value.match(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:incl\.?|including)\s+(?:all\s+)?fees/i)?.[1]
    ?? value.match(/\$([\d,]+(?:\.\d{1,2})?)(?:\s*(?:each|ea|per ticket))?/i)?.[1]
  );
  if (!section || !price) return null;
  const [quantityMin, quantityMax, quantityExplicit] =
    quantityRange(value, requestedQuantity);
  return {
    nativeId: null,
    section,
    row,
    seatFrom: null,
    seatTo: null,
    quantityMin,
    quantityMax,
    quantityExplicit,
    price,
    allIn: /(?:includes?|incl\.?|including)\s+(?:all\s+)?fees|prices include all fees/i.test(value),
    ...sharedFlags(value)
  };
}

export function parseMarketplaceCard(
  source: MarketplaceSource,
  text: string,
  context: AdapterContext,
  deepLink: string,
  nativeId?: string | null
): NormalizedListing | null {
  const parsed = source === "SeatGeek"
    ? parseSeatGeek(text, context.requestedQuantity)
    : source === "TickPick"
      ? parseTickPick(text, context.requestedQuantity)
      : source === "GameTime"
        ? parseGameTime(text, context.requestedQuantity)
        : parseStubHub(text, context.requestedQuantity);
  if (!parsed) return null;

  const providerNativeId = nativeId ?? parsed.nativeId;
  const contextualNativeId =
    providerNativeId &&
    context.requestedQuantity != null &&
    !parsed.quantityExplicit
      ? `${providerNativeId}:quantity-${context.requestedQuantity}`
      : providerNativeId;
  const identityDeepLink =
    !providerNativeId &&
    context.requestedQuantity != null &&
    !parsed.quantityExplicit
      ? `${deepLink}#purchase-quantity-${context.requestedQuantity}`
      : deepLink;
  const listingId = stableListingId({
    source,
    sourceEventId: context.sourceEventId,
    nativeId: contextualNativeId,
    section: parsed.section,
    row: parsed.row,
    seatFrom: parsed.seatFrom,
    seatTo: parsed.seatTo,
    quantityMin: parsed.quantityMin,
    quantityMax: parsed.quantityMax,
    pricePerTicket: parsed.price,
    deepLink: identityDeepLink
  });

  return {
    source,
    sourceEventId: context.sourceEventId,
    listingId,
    mlbGamePk: null,
    observedAt: context.observedAt,
    scanId: context.scanId,
    scanCompleteness: context.scanCompleteness,
    eventName: context.eventName,
    eventDate: context.eventDate,
    venue: context.venue,
    section: parsed.section,
    row: parsed.row,
    seatFrom: parsed.seatFrom,
    seatTo: parsed.seatTo,
    quantityMin: parsed.quantityMin,
    quantityMax: parsed.quantityMax,
    pricePerTicket: parsed.price,
    currency: "USD",
    allIn: parsed.allIn,
    accessible: parsed.accessible,
    limitedView: parsed.limitedView,
    notes: parsed.notes,
    deepLink
  };
}
