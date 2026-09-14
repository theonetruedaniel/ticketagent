import { z } from "zod";

export const MARKETPLACE_SOURCES = ["SeatGeek", "StubHub", "TickPick", "GameTime"] as const;
export const marketplaceSourceSchema = z.enum(MARKETPLACE_SOURCES);
export type MarketplaceSource = z.infer<typeof marketplaceSourceSchema>;

export const sourceEventReferenceSchema = z.object({
  sourceEventId: z.string().min(1).max(160),
  url: z.string().url().optional()
});

export const crossPlatformEventMappingSchema = z.object({
  mlbGamePk: z.string().min(1).max(32),
  startsAt: z.string().datetime().optional(),
  venue: z.string().max(160).default("Truist Park"),
  sources: z.object({
    SeatGeek: sourceEventReferenceSchema.optional(),
    StubHub: sourceEventReferenceSchema.optional(),
    TickPick: sourceEventReferenceSchema.optional(),
    GameTime: sourceEventReferenceSchema.optional()
  }).refine((sources) => Object.values(sources).some(Boolean), {
    message: "At least one marketplace source mapping is required"
  })
});

export const crossPlatformMappingFeedSchema = z.array(
  crossPlatformEventMappingSchema
).max(5000);

export type CrossPlatformEventMapping = z.infer<
  typeof crossPlatformEventMappingSchema
>;

export function adaptiveScanIntervalMinutes(
  startsAt: string | number | Date,
  priority = false,
  now: string | number | Date = Date.now()
): number {
  if (priority) return 5;
  const starts = new Date(startsAt).getTime();
  const reference = new Date(now).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(reference)) return 360;
  const daysUntil = (starts - reference) / 86_400_000;
  if (daysUntil > 7) return 360;
  if (daysUntil > 3) return 120;
  if (daysUntil > 1) return 30;
  return 15;
}

export function isScanDue(
  lastScannedAt: string | number | Date | null | undefined,
  intervalMinutes: number,
  now: string | number | Date = Date.now()
): boolean {
  if (!lastScannedAt) return true;
  const last = new Date(lastScannedAt).getTime();
  const reference = new Date(now).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(reference)) return true;
  return reference - last >= intervalMinutes * 60_000;
}

export const scanCompletenessSchema = z.enum(["partial", "full"]);
export type ScanCompleteness = z.infer<typeof scanCompletenessSchema>;

export const collectionModeSchema = z.enum([
  "official_api",
  "licensed_feed",
  "connector_alert",
  "browser_observed",
  "summary_only",
  "access_pending"
]);
export type CollectionMode = z.infer<typeof collectionModeSchema>;

export const priceBasisSchema = z.enum(["all_in", "before_fees", "unknown"]);
export type PriceBasis = z.infer<typeof priceBasisSchema>;

export const normalizedListingSchema = z.object({
  source: marketplaceSourceSchema,
  sourceEventId: z.string().min(1).max(160),
  listingId: z.string().min(1).max(240),
  mlbGamePk: z.string().max(32).nullable().default(null),
  observedAt: z.string().datetime(),
  scanId: z.string().min(8).max(160),
  scanCompleteness: scanCompletenessSchema,
  eventName: z.string().min(1).max(240),
  eventDate: z.string().datetime().nullable().default(null),
  venue: z.string().max(160).nullable().default("Truist Park"),
  section: z.string().min(1).max(80),
  row: z.string().max(40).nullable().default(null),
  seatFrom: z.string().max(40).nullable().default(null),
  seatTo: z.string().max(40).nullable().default(null),
  quantityMin: z.number().int().min(1).max(1000),
  quantityMax: z.number().int().min(1).max(1000),
  pricePerTicket: z.number().positive().max(100000),
  currency: z.string().length(3).default("USD"),
  allIn: z.boolean(),
  collectionMode: collectionModeSchema.optional(),
  priceBasis: priceBasisSchema.optional(),
  providerObservedAt: z.string().datetime().nullable().optional(),
  accessible: z.boolean().default(false),
  limitedView: z.boolean().default(false),
  notes: z.array(z.string().max(160)).max(20).default([]),
  deepLink: z.string().url()
}).superRefine((listing, ctx) => {
  if (listing.quantityMax < listing.quantityMin) {
    ctx.addIssue({
      code: "custom",
      path: ["quantityMax"],
      message: "quantityMax must be greater than or equal to quantityMin"
    });
  }
});

export type NormalizedListing = z.infer<typeof normalizedListingSchema>;

export const ACTIVE_BROWSER_PURCHASE_QUANTITIES = [1, 2] as const;
export type ActiveBrowserPurchaseQuantity =
  typeof ACTIVE_BROWSER_PURCHASE_QUANTITIES[number];

export function browserPurchaseQuantities(
  _source: MarketplaceSource
): readonly ActiveBrowserPurchaseQuantity[] {
  return ACTIVE_BROWSER_PURCHASE_QUANTITIES;
}

export function listingCanFulfillQuantity(
  listing: Pick<NormalizedListing, "quantityMin" | "quantityMax">,
  requestedQuantity: number
): boolean {
  return (
    listing.quantityMin <= requestedQuantity &&
    listing.quantityMax >= requestedQuantity
  );
}

export * from "./provider-evidence";

export const PRIORITY_CLUB_ALERT_KEY = "priority-club-60";
export const PRIORITY_CLUB_MAX_PRICE = 60;
export const DELTA_CLUB_MAX_PRICE = 100;
export const PRIORITY_CLUB_MAX_QUANTITY = 2;
export const INFIELD_DEAL_ALERT_KEY = "infield-deal-tiered";
export const LOWER_LEVEL_MAX_PRICE = 60;
export const NON_XFINITY_200_LEVEL_MAX_PRICE = 40;
export const MAX_ALERT_DELIVERIES_PER_HOUR = 5;

export function sectionNumber(sectionLabel: string): number | null {
  const section = Number(sectionLabel.match(/\b\d{3}\b/)?.[0] ?? NaN);
  return Number.isFinite(section) ? section : null;
}

export function infieldDealMaxPriceForSection(sectionLabel: string): number | null {
  const section = sectionNumber(sectionLabel);
  if (section == null) return null;
  if (
    section >= 122 &&
    section <= 130 &&
    sectionLabel.toLowerCase().includes("delta")
  ) {
    return DELTA_CLUB_MAX_PRICE;
  }
  if (section >= 116 && section <= 135) return LOWER_LEVEL_MAX_PRICE;
  if (section >= 216 && section <= 235) {
    return sectionLabel.toLowerCase().includes("xfinity")
      ? PRIORITY_CLUB_MAX_PRICE
      : NON_XFINITY_200_LEVEL_MAX_PRICE;
  }
  return null;
}

export function isAlertSectionAllowed(sectionLabel: string): boolean {
  const section = sectionNumber(sectionLabel);
  return section != null && (
    (section >= 116 && section <= 135) ||
    (section >= 216 && section <= 235)
  );
}

export function isPriorityClubListing(listing: NormalizedListing): boolean {
  const section = listing.section.toLowerCase();
  const numberedSection = sectionNumber(listing.section);
  const isDeltaClub =
    numberedSection != null &&
    numberedSection >= 122 &&
    numberedSection <= 130 &&
    section.includes("delta") &&
    section.includes("club");
  const isXfinityClub =
    numberedSection != null &&
    numberedSection >= 216 &&
    numberedSection <= 235 &&
    section.includes("xfinity") &&
    section.includes("club");
  const maxPrice = isDeltaClub
    ? DELTA_CLUB_MAX_PRICE
    : isXfinityClub
      ? PRIORITY_CLUB_MAX_PRICE
      : null;
  const canFulfillSingleOrPair =
    listing.quantityMin <= PRIORITY_CLUB_MAX_QUANTITY &&
    listing.quantityMax >= 1;

  return (
    maxPrice != null &&
    canFulfillSingleOrPair &&
    listing.allIn &&
    listing.currency === "USD" &&
    listing.pricePerTicket <= maxPrice
  );
}

export function isInfieldDealListing(listing: NormalizedListing): boolean {
  const maxPrice = infieldDealMaxPriceForSection(listing.section);

  return (
    maxPrice != null &&
    listing.quantityMin <= 2 &&
    listing.allIn &&
    listing.currency === "USD" &&
    listing.pricePerTicket <= maxPrice &&
    !listing.limitedView
  );
}

export const scanBatchSchema = z.object({
  scanId: z.string().min(8).max(160),
  source: marketplaceSourceSchema,
  sourceEventId: z.string().min(1).max(160),
  completeness: scanCompletenessSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  pageUrl: z.string().url(),
  extensionVersion: z.string().max(32),
  collectionMode: collectionModeSchema.optional(),
  status: z.enum(["complete", "partial", "blocked", "error"]),
  statusMessage: z.string().max(500).nullable().default(null),
  listings: z.array(normalizedListingSchema).max(5000)
});

export type ScanBatch = z.infer<typeof scanBatchSchema>;

export const alertRuleSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["price", "priceDrop", "newListing"]),
  enabled: z.boolean(),
  mlbGamePk: z.string().nullable(),
  source: marketplaceSourceSchema.nullable(),
  sectionQuery: z.string().max(80).nullable(),
  quantity: z.number().int().min(1).max(20),
  maxPrice: z.number().positive().nullable(),
  accessible: z.boolean().nullable(),
  emailEnabled: z.boolean()
});

export type AlertRule = z.infer<typeof alertRuleSchema>;

export type AlertMatchContext = {
  isNew: boolean;
  previousPrice?: number;
};

export function alertMatchesListing(
  alert: AlertRule,
  listing: NormalizedListing,
  context: AlertMatchContext
): boolean {
  if (!alert.enabled) return false;
  if (alert.source && alert.source !== listing.source) return false;
  if (alert.mlbGamePk && alert.mlbGamePk !== listing.mlbGamePk) return false;
  if (!isAlertSectionAllowed(listing.section)) return false;
  if (
    alert.sectionQuery &&
    !listing.section.toLowerCase().includes(alert.sectionQuery.toLowerCase())
  ) return false;
  if (!listingCanFulfillQuantity(listing, alert.quantity)) return false;
  if (alert.accessible !== null && listing.accessible !== alert.accessible) return false;
  if (alert.maxPrice !== null && listing.pricePerTicket > alert.maxPrice) return false;
  if (alert.type === "newListing") return context.isNew;
  if (alert.type === "priceDrop") {
    return context.previousPrice !== undefined && listing.pricePerTicket < context.previousPrice;
  }
  return alert.maxPrice !== null;
}

export function alertCooldownKey(
  ruleId: string,
  source: MarketplaceSource,
  listingId: string,
  observedAt: string | number | Date,
  cooldownMinutes = 15
): string {
  const timestamp = new Date(observedAt).getTime();
  const bucket = Math.floor(timestamp / (cooldownMinutes * 60 * 1000));
  return `${ruleId}:${source}:${listingId}:${bucket}`;
}

export function listingIdsToRetire(
  currentlyAvailableIds: string[],
  observedIds: Iterable<string>,
  completeness: ScanCompleteness,
  status: ScanBatch["status"]
): string[] {
  if (completeness !== "full" || status !== "complete") return [];
  const observed = new Set(observedIds);
  return currentlyAvailableIds.filter((id) => !observed.has(id));
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function emailRetryState(
  previousAttempts: number,
  now: string | number | Date = Date.now()
) {
  const attempts = previousAttempts + 1;
  const nextAttemptAt = new Date(
    new Date(now).getTime() + Math.min(60, 2 ** attempts) * 60_000
  ).toISOString();
  return {
    attempts,
    status: attempts >= 5 ? "failed" as const : "pending" as const,
    nextAttemptAt
  };
}

export type FreshnessState = "fresh" | "aging" | "stale";

export function freshnessState(observedAt: string | number | Date, now = Date.now()): FreshnessState {
  const ageMinutes = Math.max(0, now - new Date(observedAt).getTime()) / 60000;
  if (ageMinutes < 15) return "fresh";
  if (ageMinutes < 60) return "aging";
  return "stale";
}

export type SectionProfile = {
  zone: "premium" | "infield" | "baseline" | "outfield" | "upper" | "unknown";
  level: number;
  quality: number;
  label: string;
};

const KNOWN_SECTIONS: Record<string, SectionProfile> = {
  "115": { zone: "premium", level: 100, quality: 96, label: "3B dugout" },
  "118": { zone: "premium", level: 100, quality: 94, label: "Home plate" },
  "121": { zone: "premium", level: 100, quality: 92, label: "Home plate" },
  "124": { zone: "premium", level: 100, quality: 90, label: "1B dugout" },
  "125": { zone: "infield", level: 100, quality: 87, label: "1B infield" },
  "126": { zone: "infield", level: 100, quality: 85, label: "1B infield" },
  "128": { zone: "baseline", level: 100, quality: 79, label: "1B line" },
  "104": { zone: "baseline", level: 100, quality: 78, label: "3B line" },
  "105": { zone: "baseline", level: 100, quality: 79, label: "3B line" },
  "112": { zone: "infield", level: 100, quality: 86, label: "3B infield" },
  "113": { zone: "infield", level: 100, quality: 86, label: "3B infield" },
  "122": { zone: "premium", level: 100, quality: 90, label: "1B dugout" },
  "123": { zone: "premium", level: 100, quality: 89, label: "1B dugout" },
  "210": { zone: "infield", level: 200, quality: 84, label: "Terrace infield" },
  "213": { zone: "infield", level: 200, quality: 86, label: "3B terrace" },
  "216": { zone: "infield", level: 200, quality: 88, label: "Home plate terrace" },
  "218": { zone: "infield", level: 200, quality: 87, label: "Home plate terrace" },
  "220": { zone: "infield", level: 200, quality: 84, label: "1B terrace" },
  "243": { zone: "outfield", level: 200, quality: 61, label: "RF corner" }
};

export function sectionProfile(section: string): SectionProfile {
  const normalized = section.match(/\d{3}/)?.[0] ?? "";
  if (KNOWN_SECTIONS[normalized]) return KNOWN_SECTIONS[normalized];
  const level = normalized ? Number(normalized[0]) * 100 : 999;
  const zone = level <= 200 ? "baseline" : level <= 300 ? "upper" : "outfield";
  const quality = level === 100 ? 76 : level === 200 ? 72 : level === 300 ? 56 : 42;
  return { zone, level, quality, label: normalized ? `Section ${normalized}` : section };
}

export function dealScore(
  listing: Pick<NormalizedListing, "pricePerTicket" | "section" | "allIn" | "limitedView" | "accessible">,
  eventMedianPrice = 75
): number {
  const profile = sectionProfile(listing.section);
  const valueRatio = eventMedianPrice > 0 ? eventMedianPrice / listing.pricePerTicket : 1;
  const priceScore = Math.min(100, Math.max(0, valueRatio * 52));
  const feeConfidence = listing.allIn ? 8 : 0;
  const restrictionPenalty = listing.limitedView ? 24 : 0;
  const accessibleNeutralizer = listing.accessible ? 2 : 0;
  return Math.round(Math.min(100, profile.quality * 0.5 + priceScore * 0.42 + feeConfidence - restrictionPenalty - accessibleNeutralizer));
}

export function stableListingId(input: {
  source: MarketplaceSource;
  sourceEventId: string;
  nativeId?: string | null;
  section: string;
  row?: string | null;
  seatFrom?: string | null;
  seatTo?: string | null;
  quantityMin: number;
  quantityMax: number;
  pricePerTicket: number;
  deepLink: string;
}): string {
  if (input.nativeId) return `${input.source}:${input.nativeId}`;
  const raw = [
    input.source,
    input.sourceEventId,
    input.section,
    input.row ?? "",
    input.seatFrom ?? "",
    input.seatTo ?? "",
    input.deepLink
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${input.source}:derived:${(hash >>> 0).toString(36)}`;
}

export type CanonicalBravesEvent = {
  id: string;
  mlbGamePk: string;
  opponent: string;
  startsAt: string;
  venue: string;
};

function comparableWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !["the", "atlanta", "braves", "tickets"].includes(word));
}

export function matchCanonicalBravesEvent(
  listing: Pick<NormalizedListing, "mlbGamePk" | "eventName" | "eventDate" | "venue">,
  events: CanonicalBravesEvent[]
): CanonicalBravesEvent | null {
  if (listing.mlbGamePk) {
    const exact = events.find((event) => event.mlbGamePk === listing.mlbGamePk);
    if (exact) return exact;
  }
  if (!listing.eventDate) return null;

  const listingTime = Date.parse(listing.eventDate);
  if (!Number.isFinite(listingTime)) return null;
  const listingWords = new Set(comparableWords(listing.eventName));
  const listingVenue = listing.venue?.toLowerCase() ?? "";

  const ranked = events
    .map((event) => {
      const differenceHours = Math.abs(Date.parse(event.startsAt) - listingTime) / 3_600_000;
      const opponentWords = comparableWords(event.opponent);
      const opponentMatches = opponentWords.some((word) => listingWords.has(word));
      const venueMatches =
        listingVenue.includes("truist park") && event.venue.toLowerCase().includes("truist park");
      const score = (differenceHours <= 1 ? 50 : differenceHours <= 6 ? 30 : 0)
        + (opponentMatches ? 30 : 0)
        + (venueMatches ? 20 : 0);
      return { event, differenceHours, opponentMatches, venueMatches, score };
    })
    .filter((candidate) =>
      candidate.differenceHours <= 6 &&
      candidate.opponentMatches &&
      candidate.venueMatches
    )
    .sort((a, b) => b.score - a.score || a.differenceHours - b.differenceHours);

  return ranked[0]?.event ?? null;
}

export function isBravesHomeEvent(eventName: string, venue?: string | null): boolean {
  const text = `${eventName} ${venue ?? ""}`.toLowerCase();
  const bravesHomePattern = /(at|vs\.?|versus)\s+(the\s+)?atlanta braves|braves\s+vs\.?/;
  return text.includes("truist park") && bravesHomePattern.test(text);
}

export * from "./adapters";
