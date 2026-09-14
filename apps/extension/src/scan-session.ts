import type { NormalizedListing, ScanBatch } from "@ticket-agent/contracts";

export function listingStorageKey(
  listing: Pick<NormalizedListing, "source" | "listingId">
) {
  return `${listing.source}:${listing.listingId}`;
}

export function reconcileLocalListings(
  existing: NormalizedListing[],
  batch: ScanBatch
) {
  const merged = new Map(
    existing.map((listing) => [listingStorageKey(listing), listing])
  );
  const observed = new Set(
    batch.listings.map((listing) => listingStorageKey(listing))
  );

  if (batch.completeness === "full" && batch.status === "complete") {
    for (const [key, listing] of merged) {
      if (
        listing.source === batch.source &&
        listing.sourceEventId === batch.sourceEventId &&
        !observed.has(key)
      ) {
        merged.delete(key);
      }
    }
  }

  for (const listing of batch.listings) {
    merged.set(listingStorageKey(listing), listing);
  }
  return [...merged.values()];
}

export class ScanAccumulator {
  private readonly listings = new Map<string, NormalizedListing>();
  private previousSize = -1;
  stablePasses = 0;

  add(passListings: NormalizedListing[]) {
    for (const listing of passListings) {
      this.listings.set(listingStorageKey(listing), listing);
    }
    if (this.listings.size === this.previousSize) this.stablePasses += 1;
    else this.stablePasses = 0;
    this.previousSize = this.listings.size;
    return this.listings.size;
  }

  values() {
    return [...this.listings.values()];
  }
}
