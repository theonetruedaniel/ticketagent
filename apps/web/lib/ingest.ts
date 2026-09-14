import {
  alertCooldownKey,
  alertMatchesListing,
  INFIELD_DEAL_ALERT_KEY,
  isBravesHomeEvent,
  isInfieldDealListing,
  isPriorityClubListing,
  matchCanonicalBravesEvent,
  listingIdsToRetire,
  PRIORITY_CLUB_ALERT_KEY,
  scanBatchSchema,
  type AlertRule,
  type CanonicalBravesEvent,
  type ScanBatch
} from "@ticket-agent/contracts";
import { createAdminClient } from "./supabase/server";

type PreviousListing = {
  listing_id: string;
  first_seen_at: string;
  price_per_ticket: number | string;
};

function listingRow(
  batch: ScanBatch,
  ownerId: string,
  eventId: string | null,
  listing: ScanBatch["listings"][number],
  previous?: PreviousListing
) {
  return {
    owner_id: ownerId,
    event_id: eventId,
    mlb_game_pk: listing.mlbGamePk,
    source: listing.source,
    source_event_id: listing.sourceEventId,
    listing_id: listing.listingId,
    observed_at: listing.observedAt,
    first_seen_at: previous?.first_seen_at ?? listing.observedAt,
    last_scan_id: batch.scanId,
    last_scan_completeness: batch.completeness,
    section: listing.section,
    row_label: listing.row,
    seat_from: listing.seatFrom,
    seat_to: listing.seatTo,
    quantity_min: listing.quantityMin,
    quantity_max: listing.quantityMax,
    price_per_ticket: listing.pricePerTicket,
    currency: listing.currency,
    all_in: listing.allIn,
    collection_mode: listing.collectionMode ?? batch.collectionMode ?? "browser_observed",
    price_basis: listing.priceBasis ?? (listing.allIn ? "all_in" : "unknown"),
    provider_observed_at: listing.providerObservedAt ?? null,
    accessible: listing.accessible,
    limited_view: listing.limitedView,
    notes: listing.notes,
    deep_link: listing.deepLink,
    available: true,
    unavailable_at: null
  };
}

async function matchEvent(batch: ScanBatch) {
  const supabase = createAdminClient();
  const { data: mapping, error: mappingError } = await supabase
    .from("source_events")
    .select("event_id")
    .eq("source", batch.source)
    .eq("source_event_id", batch.sourceEventId)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (mapping?.event_id) {
    const { data: mappedEvent, error: mappedEventError } = await supabase
      .from("events")
      .select("id,mlb_game_pk")
      .eq("id", mapping.event_id)
      .maybeSingle();
    if (mappedEventError) throw mappedEventError;
    if (mappedEvent) return mappedEvent;
  }

  const first = batch.listings[0];
  if (!first) return null;
  if (first.mlbGamePk) {
    const { data: exactEvent, error: exactError } = await supabase
      .from("events")
      .select("id,mlb_game_pk")
      .eq("mlb_game_pk", first.mlbGamePk)
      .maybeSingle();
    if (exactError) throw exactError;
    if (exactEvent) return exactEvent;
  }
  if (!first.eventDate) return null;
  const starts = first.eventDate ? Date.parse(first.eventDate) : Date.now();
  const { data, error } = await supabase
    .from("events")
    .select("id,mlb_game_pk,opponent,starts_at,venue")
    .eq("venue", "Truist Park")
    .gte("starts_at", new Date(starts - 12 * 60 * 60 * 1000).toISOString())
    .lte("starts_at", new Date(starts + 12 * 60 * 60 * 1000).toISOString());
  if (error) throw error;
  const events: CanonicalBravesEvent[] = (data ?? []).map((event) => ({
    id: event.id,
    mlbGamePk: event.mlb_game_pk,
    opponent: event.opponent,
    startsAt: event.starts_at,
    venue: event.venue
  }));
  const matched = matchCanonicalBravesEvent(first, events);
  if (!matched) return null;
  return { id: matched.id, mlb_game_pk: matched.mlbGamePk };
}

async function updateBrowserSourceHealth(
  batch: ScanBatch,
  eventId: string | null
) {
  if (batch.source !== "SeatGeek" && batch.source !== "StubHub") return;
  if ((batch.collectionMode ?? "browser_observed") !== "browser_observed") return;

  const supabase = createAdminClient();
  const { data: sourceEvent, error: sourceError } = await supabase
    .from("source_events")
    .select("event_id,summary")
    .eq("source", batch.source)
    .eq("source_event_id", batch.sourceEventId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  const summary =
    sourceEvent?.summary && typeof sourceEvent.summary === "object"
      ? sourceEvent.summary as Record<string, unknown>
      : {};
  const successful =
    batch.status === "complete" && batch.completeness === "full";
  const previousFailureStreak = Number(summary.browserFailureStreak ?? 0);
  const failureStreak = successful
    ? 0
    : Math.max(0, Number.isFinite(previousFailureStreak) ? previousFailureStreak : 0) + 1;
  const qualifyingCount = batch.listings.filter((listing) =>
    isPriorityClubListing(listing) || isInfieldDealListing(listing)
  ).length;
  const lowestAllIn = batch.listings
    .filter((listing) => listing.allIn && listing.priceBasis === "all_in")
    .reduce<number | null>(
      (lowest, listing) =>
        lowest == null ? listing.pricePerTicket : Math.min(lowest, listing.pricePerTicket),
      null
    );
  const nextSummary: Record<string, unknown> = {
    ...summary,
    browserLastAttemptAt: batch.completedAt,
    browserFailureStreak: failureStreak,
    browserHeartbeatStatus: successful ? "ok" : "error",
    browserHeartbeatMessage: successful
      ? `${batch.source} local Chrome scan completed with ${batch.listings.length} fee-proven listings.`
      : batch.statusMessage ?? `${batch.source} local Chrome scan did not complete.`,
    browserLowestAllIn: lowestAllIn,
    browserQualifyingCount: qualifyingCount,
    browserRuntimeOrigin: "local_chrome"
  };
  if (successful) nextSummary.browserLastSuccessAt = batch.completedAt;

  const mappedEventId = eventId ?? sourceEvent?.event_id ?? null;
  if (!mappedEventId) return;
  const { error } = await supabase.from("source_events").upsert({
    event_id: mappedEventId,
    source: batch.source,
    source_event_id: batch.sourceEventId,
    summary: nextSummary
  }, { onConflict: "source,source_event_id" });
  if (error) throw error;
}

async function queueAlerts(
  ownerId: string,
  eventId: string | null,
  batch: ScanBatch,
  previous: Map<string, PreviousListing>
) {
  const supabase = createAdminClient();
  const { data: rules, error: rulesError } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("enabled", true)
    .eq("email_enabled", true);
  if (rulesError) throw rulesError;

  let queued = 0;
  for (const listing of batch.listings) {
    const priorityClub = isPriorityClubListing(listing);
    const infieldDeal = !priorityClub && isInfieldDealListing(listing);
    const systemAlertType = priorityClub
      ? "priorityClub"
      : infieldDeal
        ? "infieldDeal"
        : null;
    const matchingRules = systemAlertType ? [null] : (rules ?? []);
    for (const rule of matchingRules) {
      const prior = previous.get(listing.listingId);
      const normalizedRule: AlertRule | null = rule == null ? null : {
        id: rule.id,
        type: rule.rule_type,
        enabled: rule.enabled,
        mlbGamePk: null,
        source: rule.source,
        sectionQuery: rule.section_query,
        quantity: rule.quantity,
        maxPrice: rule.max_price == null ? null : Number(rule.max_price),
        accessible: rule.accessible,
        emailEnabled: rule.email_enabled
      };
      const matches = systemAlertType != null || (
        rule != null &&
        normalizedRule != null &&
        (!rule.event_id || rule.event_id === eventId) &&
        alertMatchesListing(normalizedRule, listing, {
          isNew: !prior,
          previousPrice: prior == null ? undefined : Number(prior.price_per_ticket)
        })
      );
      if (!matches) continue;

      let recentDeliveryQuery = supabase
        .from("email_outbox")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("listing_source", listing.source)
        .eq("listing_id", listing.listingId)
        .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
        .limit(1);
      recentDeliveryQuery = rule == null
        ? recentDeliveryQuery.is("alert_rule_id", null)
        : recentDeliveryQuery.eq("alert_rule_id", rule.id);
      const { data: recentDelivery, error: cooldownError } =
        await recentDeliveryQuery.maybeSingle();
      if (cooldownError) throw cooldownError;
      if (recentDelivery) continue;

      const idempotencyKey = alertCooldownKey(
        rule?.id ?? (
          systemAlertType === "priorityClub"
            ? PRIORITY_CLUB_ALERT_KEY
            : INFIELD_DEAL_ALERT_KEY
        ),
        listing.source,
        listing.listingId,
        batch.completedAt
      );
      const { error } = await supabase.from("email_outbox").upsert(
        {
          owner_id: ownerId,
          alert_rule_id: rule?.id ?? null,
          listing_source: listing.source,
          listing_id: listing.listingId,
          payload: {
            eventId,
            listing,
            type: rule?.rule_type ?? systemAlertType,
            priority: priorityClub,
            infieldDeal
          },
          idempotency_key: idempotencyKey,
          status: "pending",
          next_attempt_at: new Date().toISOString()
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );
      if (!error) queued += 1;
    }
  }
  return queued;
}

export async function ingestScan(raw: unknown, ownerId: string, tokenId?: string) {
  const batch = scanBatchSchema.parse(raw);
  if (
    (batch.source === "SeatGeek" || batch.source === "StubHub") &&
    (batch.collectionMode ?? "browser_observed") === "browser_observed" &&
    batch.listings.some((listing) =>
      listing.allIn !== true ||
      listing.priceBasis !== "all_in" ||
      listing.collectionMode !== "browser_observed"
    )
  ) {
    throw new Error(
      "Restricted browser scans require explicit all-in evidence on every listing"
    );
  }
  const describedEvent = batch.listings[0];
  if (describedEvent && !isBravesHomeEvent(describedEvent.eventName, describedEvent.venue)) {
    throw new Error("Only Braves home games at Truist Park are accepted");
  }
  const supabase = createAdminClient();

  const { data: prior } = await supabase
    .from("scan_runs")
    .select("id,listing_count")
    .eq("scan_id", batch.scanId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (prior) {
    return { duplicate: true, listingCount: prior.listing_count, unavailableCount: 0, alertsQueued: 0 };
  }

  const event = await matchEvent(batch);
  if (batch.listings.length && !event) {
    throw new Error("The scan could not be matched to a scheduled Braves home game");
  }
  const now = new Date().toISOString();
  if (
    event &&
    batch.status !== "blocked" &&
    batch.status !== "error" &&
    (batch.listings.length > 0 ||
      (batch.completeness === "full" && batch.status === "complete"))
  ) {
    const { error: mappingError } = await supabase.from("source_events").upsert(
      {
        event_id: event.id,
        source: batch.source,
        source_event_id: batch.sourceEventId,
        last_observed_at: batch.completedAt
      },
      { onConflict: "source,source_event_id" }
    );
    if (mappingError) throw mappingError;
  }
  const previous = new Map<string, PreviousListing>();
  for (let offset = 0; offset < batch.listings.length; offset += 200) {
    const ids = batch.listings.slice(offset, offset + 200).map((listing) => listing.listingId);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("listings")
      .select("listing_id,first_seen_at,price_per_ticket")
      .eq("owner_id", ownerId)
      .eq("source", batch.source)
      .in("listing_id", ids);
    if (error) throw error;
    data?.forEach((row) => previous.set(row.listing_id, row));
  }
  const { error: scanError } = await supabase.from("scan_runs").insert({
    owner_id: ownerId,
    extension_token_id: tokenId === "dev" ? null : tokenId,
    scan_id: batch.scanId,
    source: batch.source,
    source_event_id: batch.sourceEventId,
    event_id: event?.id ?? null,
    completeness: batch.completeness,
    status: batch.status,
    status_message: batch.statusMessage,
    started_at: batch.startedAt,
    completed_at: batch.completedAt,
    listing_count: batch.listings.length,
    page_url: batch.pageUrl,
    extension_version: batch.extensionVersion,
    collection_mode: batch.collectionMode ?? "browser_observed"
  });
  if (scanError) {
    if (scanError.code === "23505") {
      return { duplicate: true, listingCount: batch.listings.length, unavailableCount: 0, alertsQueued: 0 };
    }
    throw scanError;
  }

  try {
    if (batch.listings.length) {
      const rows = batch.listings.map((listing) =>
        listingRow(batch, ownerId, event?.id ?? null, {
          ...listing,
          mlbGamePk: listing.mlbGamePk ?? event?.mlb_game_pk ?? null
        }, previous.get(listing.listingId))
      );
      const { error } = await supabase
        .from("listings")
        .upsert(rows, { onConflict: "owner_id,source,listing_id" });
      if (error) throw error;

      const { error: observationError } = await supabase.from("listing_observations").insert(
        rows.map((row) => ({
          owner_id: ownerId,
          event_id: row.event_id,
          scan_id: batch.scanId,
          source: row.source,
          listing_id: row.listing_id,
          observed_at: row.observed_at,
          price_per_ticket: row.price_per_ticket,
          quantity_min: row.quantity_min,
          quantity_max: row.quantity_max,
          all_in: row.all_in,
          collection_mode: row.collection_mode,
          price_basis: row.price_basis,
          provider_observed_at: row.provider_observed_at,
          snapshot: row
        }))
      );
      if (observationError && observationError.code !== "23505") throw observationError;
    }

    let unavailableCount = 0;
    if (batch.completeness === "full" && batch.status === "complete") {
      const { data: currentListings, error: currentError } = await supabase
        .from("listings")
        .select("id,listing_id")
        .eq("owner_id", ownerId)
        .eq("source", batch.source)
        .eq("source_event_id", batch.sourceEventId)
        .eq("available", true);
      if (currentError) throw currentError;
      const retireListingIds = new Set(listingIdsToRetire(
        (currentListings ?? []).map((listing) => listing.listing_id),
        batch.listings.map((listing) => listing.listingId),
        batch.completeness,
        batch.status
      ));
      const missingIds = (currentListings ?? [])
        .filter((listing) => retireListingIds.has(listing.listing_id))
        .map((listing) => listing.id);
      for (let offset = 0; offset < missingIds.length; offset += 200) {
        const chunk = missingIds.slice(offset, offset + 200);
        const { data, error } = await supabase
          .from("listings")
          .update({ available: false, unavailable_at: now })
          .in("id", chunk)
          .select("id");
        if (error) throw error;
        unavailableCount += data?.length ?? 0;
      }
    }

    const alertsQueued = await queueAlerts(ownerId, event?.id ?? null, batch, previous);
    await updateBrowserSourceHealth(batch, event?.id ?? null);
    console.info("Browser scan ingested", {
      source: batch.source,
      sourceEventId: batch.sourceEventId,
      status: batch.status,
      completeness: batch.completeness,
      listingCount: batch.listings.length,
      unavailableCount,
      alertsQueued
    });
    return { duplicate: false, listingCount: batch.listings.length, unavailableCount, alertsQueued };
  } catch (error) {
    const { error: cleanupError } = await supabase
      .from("scan_runs")
      .delete()
      .eq("owner_id", ownerId)
      .eq("scan_id", batch.scanId);
    if (cleanupError) console.error("Could not release failed scan idempotency key", cleanupError);
    throw error;
  }
}
