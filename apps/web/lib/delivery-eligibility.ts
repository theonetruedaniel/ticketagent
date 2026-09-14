import {
  isAlertSectionAllowed,
  isInfieldDealListing,
  isPriorityClubListing,
  normalizedListingSchema
} from "@ticket-agent/contracts";

type SystemAlertPayload = {
  infieldDeal?: unknown;
  listing?: unknown;
  priority?: unknown;
};

export function systemAlertDeliveryEligible(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;

  const candidate = payload as SystemAlertPayload;
  const listing = normalizedListingSchema.safeParse(candidate.listing);
  if (!listing.success || !isAlertSectionAllowed(listing.data.section)) return false;

  const isPriorityAlert = candidate.priority === true;
  const isInfieldAlert = candidate.infieldDeal === true;
  if (!isPriorityAlert && !isInfieldAlert) return true;

  return isPriorityAlert
    ? isPriorityClubListing(listing.data)
    : isInfieldDealListing(listing.data);
}
