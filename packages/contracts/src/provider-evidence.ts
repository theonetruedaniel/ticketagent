import type { MarketplaceSource } from "./index";

export type ProviderEvidenceCandidate = {
  source: "SeatGeek" | "StubHub";
  nativeId: string;
  section: string;
  row: string | null;
  quantityMin: number;
  quantityMax: number;
  pricePerTicket: number;
  currency: string;
  deepLink: string;
  providerObservedAt: string;
  accessible: boolean;
  limitedView: boolean;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nestedRecord(value: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const found = record(value[key]);
    if (found) return found;
  }
  return null;
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const nested = record(value);
    if (!nested) continue;
    for (const key of ["name", "label", "text", "value"]) {
      if (typeof nested[key] === "string" && nested[key].trim()) {
        return nested[key].trim();
      }
    }
  }
  return null;
}

function number(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[$,]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const nested = record(value);
    if (!nested) continue;
    const parsed = number(nested.amount, nested.value);
    if (parsed != null) return parsed;
  }
  return null;
}

function boolean(...values: unknown[]) {
  return values.some((value) => value === true || value === "true");
}

function date(value: unknown, fallback: string) {
  const candidate = text(value);
  if (!candidate) return fallback;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function link(value: JsonRecord, pageUrl: string, nativeId: string) {
  const links = nestedRecord(value, "_links", "links");
  const candidate = text(
    value.deepLink,
    value.listingUrl,
    value.listing_url,
    value.url,
    record(links?.webpage)?.href,
    record(links?.web)?.href
  );
  if (candidate) {
    try {
      return new URL(candidate, pageUrl).href;
    } catch {
      // Keep a stable event-page anchor when the provider link is malformed.
    }
  }
  const url = new URL(pageUrl);
  url.hash = `listing-${encodeURIComponent(nativeId)}`;
  return url.href;
}

function explicitQuantity(item: JsonRecord): [number, number] | null {
  const minimum = number(
    item.minQuantity,
    item.min_quantity,
    item.minimumQuantity,
    item.minimum_purchase_quantity
  );
  const maximum = number(
    item.maxQuantity,
    item.max_quantity,
    item.availableQuantity,
    item.quantity,
    item.numberOfTickets,
    item.number_of_tickets
  );
  if (minimum == null && maximum == null) return null;
  const quantityMin = Math.max(1, Math.trunc(minimum ?? maximum ?? 1));
  const quantityMax = Math.max(
    quantityMin,
    Math.trunc(maximum ?? minimum ?? quantityMin)
  );
  return [quantityMin, quantityMax];
}

function seatLocation(item: JsonRecord) {
  const seating = nestedRecord(item, "seating", "displaySeating", "display_seating");
  const section = text(
    item.section,
    item.sectionName,
    item.section_name,
    item.displaySection,
    seating?.section,
    seating?.sectionName
  );
  if (!section) return null;
  return {
    section,
    row: text(item.row, item.rowName, item.row_name, seating?.row, seating?.rowName)
  };
}

function seatGeekPrice(item: JsonRecord) {
  const price = nestedRecord(item, "price", "pricing", "ticketPrice");
  return number(
    item.priceWithFees,
    item.price_with_fees,
    price?.priceWithFees,
    price?.price_with_fees
  );
}

function stubHubPrice(item: JsonRecord) {
  const priceInfo = nestedRecord(item, "priceInfo", "price_info", "pricing");
  const qualifier = text(
    priceInfo?.qualifier,
    nestedRecord(priceInfo ?? {}, "qualifier")?.text,
    item.priceQualifier,
    item.price_qualifier
  );
  if (!qualifier || !/(?:incl\.?|including)\s+(?:all\s+)?fees|fees\s+included/i.test(qualifier)) {
    return null;
  }
  return number(
    priceInfo?.amount,
    priceInfo?.price,
    priceInfo?.value,
    item.allInPrice,
    item.all_in_price,
    item.priceWithFees,
    item.price_with_fees
  );
}

export function extractProviderEvidenceCandidates(
  source: MarketplaceSource,
  payload: unknown,
  pageUrl: string,
  observedAt = new Date().toISOString(),
  maximumCandidates = 5000
): ProviderEvidenceCandidate[] {
  if (source !== "SeatGeek" && source !== "StubHub") return [];

  const output = new Map<string, ProviderEvidenceCandidate>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  const seen = new Set<object>();
  let visited = 0;

  while (queue.length && output.size < maximumCandidates && visited < 30_000) {
    const current = queue.shift()!;
    visited += 1;
    if (current.value == null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.depth < 10) {
        for (const child of current.value.slice(0, 5000)) {
          queue.push({ value: child, depth: current.depth + 1 });
        }
      }
      continue;
    }

    const item = current.value as JsonRecord;
    const location = seatLocation(item);
    const quantity = explicitQuantity(item);
    const nativeId = text(item.listingId, item.listing_id, item.id, item.ticketId);
    const pricePerTicket = source === "SeatGeek"
      ? seatGeekPrice(item)
      : stubHubPrice(item);

    if (
      location &&
      quantity &&
      nativeId &&
      pricePerTicket != null &&
      pricePerTicket <= 100_000
    ) {
      const currency = text(
        nestedRecord(item, "priceInfo", "price_info", "price", "pricing")?.currency,
        item.currency
      )?.toUpperCase() ?? "USD";
      if (currency === "USD") {
        const candidate: ProviderEvidenceCandidate = {
          source,
          nativeId,
          section: location.section,
          row: location.row,
          quantityMin: quantity[0],
          quantityMax: quantity[1],
          pricePerTicket,
          currency,
          deepLink: link(item, pageUrl, nativeId),
          providerObservedAt: date(
            item.updatedAt ?? item.updated_at ?? item.lastModified ?? item.last_modified,
            observedAt
          ),
          accessible: boolean(item.accessible, nestedRecord(item, "seating")?.accessible),
          limitedView: boolean(
            item.limitedView,
            item.limited_view,
            nestedRecord(item, "seating")?.limitedView
          )
        };
        output.set(
          `${source}:${nativeId}:${candidate.quantityMin}:${candidate.quantityMax}`,
          candidate
        );
      }
    }

    if (current.depth < 10) {
      for (const child of Object.values(item)) {
        if (child != null && typeof child === "object") {
          queue.push({ value: child, depth: current.depth + 1 });
        }
      }
    }
  }

  return [...output.values()];
}
