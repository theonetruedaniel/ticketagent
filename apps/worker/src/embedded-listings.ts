import type { CandidateCard } from "./types";

const PRICE_KEYS = [
  "priceWithFees",
  "allInPrice",
  "displayPrice",
  "ticketPrice",
  "price",
  "amount"
] as const;
const SECTION_KEYS = ["section", "sectionName", "section_name"] as const;
const ROW_KEYS = ["row", "rowName", "row_name"] as const;
const QUANTITY_KEYS = [
  "quantity",
  "availableQuantity",
  "maxQuantity",
  "ticketQuantity"
] as const;
const MIN_QUANTITY_KEYS = [
  "minQuantity",
  "minimumQuantity",
  "minimumPurchaseQuantity",
  "min_quantity",
  "minimum_purchase_quantity"
] as const;
const MAX_QUANTITY_KEYS = [
  "maxQuantity",
  "maximumQuantity",
  "availableQuantity",
  "quantity",
  "max_quantity"
] as const;
const ID_KEYS = ["listingId", "listing_id", "id", "ticketId"] as const;
const URL_KEYS = ["url", "listingUrl", "listing_url", "deepLink"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const nested = record(value);
  if (!nested) return null;
  for (const key of ["name", "label", "value"]) {
    if (typeof nested[key] === "string" && nested[key].trim()) {
      return nested[key].trim();
    }
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const nested = record(value);
  if (!nested) return null;
  return numberValue(nested.amount ?? nested.value);
}

function firstText(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const found = textValue(value[key]);
    if (found) return found;
  }
  return null;
}

function firstNumber(
  value: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const found = numberValue(value[key]);
    if (found != null) return found;
  }
  return null;
}

function deepLink(value: Record<string, unknown>, pageUrl: string, id: string | null) {
  const candidate = firstText(value, URL_KEYS);
  if (candidate) {
    try {
      return new URL(candidate, pageUrl).href;
    } catch {
      // Fall back to the marketplace event page.
    }
  }
  if (!id) return pageUrl;
  const url = new URL(pageUrl);
  url.hash = `listing-${encodeURIComponent(id)}`;
  return url.href;
}

export function extractEmbeddedListingCandidates(
  payload: unknown,
  pageUrl: string,
  maximumCandidates = 5000
): CandidateCard[] {
  const output = new Map<string, CandidateCard>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  const seen = new Set<object>();
  let visited = 0;

  while (queue.length && output.size < maximumCandidates && visited < 20_000) {
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

    const item = current.value as Record<string, unknown>;
    const section = firstText(item, SECTION_KEYS);
    const price = firstNumber(item, PRICE_KEYS);
    if (section && price != null && price > 0 && price <= 100_000) {
      const row = firstText(item, ROW_KEYS);
      const quantity = Math.max(
        1,
        Math.min(1000, Math.trunc(firstNumber(item, QUANTITY_KEYS) ?? 1))
      );
      const quantityMin = Math.max(
        1,
        Math.min(1000, Math.trunc(firstNumber(item, MIN_QUANTITY_KEYS) ?? quantity))
      );
      const quantityMax = Math.max(
        quantityMin,
        Math.min(1000, Math.trunc(firstNumber(item, MAX_QUANTITY_KEYS) ?? quantity))
      );
      const id = firstText(item, ID_KEYS);
      const link = deepLink(item, pageUrl, id);
      const location = row
        ? `Section ${section} Row ${row}`
        : `Section ${section},`;
      const candidate: CandidateCard = {
        text: `${location} ${
          quantityMin === quantityMax
            ? quantityMax
            : `${quantityMin}-${quantityMax}`
        } Tickets $${price.toFixed(2)} ea`,
        deepLink: link,
        nativeId: id
      };
      output.set(
        id ?? `${section}|${row ?? ""}|${price}|${quantityMin}|${quantityMax}|${link}`,
        candidate
      );
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

export function describeEmbeddedPayload(payload: unknown, maximumEntries = 160) {
  const entries: Array<{ path: string; value: string | number | boolean | null }> = [];
  const queue: Array<{ value: unknown; path: string; depth: number }> = [{
    value: payload,
    path: "$",
    depth: 0
  }];
  const interesting = /price|section|row|listing|ticket|inventory|seat|quantity|offer/i;
  while (queue.length && entries.length < maximumEntries) {
    const current = queue.shift()!;
    if (current.depth > 9 || current.value == null || typeof current.value !== "object") {
      continue;
    }
    const values = Array.isArray(current.value)
      ? current.value.slice(0, 12).map((value, index) => [String(index), value] as const)
      : Object.entries(current.value as Record<string, unknown>);
    for (const [key, value] of values) {
      const path = `${current.path}.${key}`;
      if (
        interesting.test(key)
        && (value == null || ["string", "number", "boolean"].includes(typeof value))
      ) {
        entries.push({
          path,
          value: typeof value === "string" ? value.slice(0, 180) : value as number | boolean | null
        });
      }
      if (value != null && typeof value === "object") {
        queue.push({ value, path, depth: current.depth + 1 });
      }
      if (entries.length >= maximumEntries) break;
    }
  }
  return entries;
}
