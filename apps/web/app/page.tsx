import { currentIdentity } from "@/lib/auth";
import {
  demoAlerts,
  demoEvents,
  demoHistory,
  demoListings,
  type DashboardEvent,
  type DashboardHistoryPoint
} from "@/lib/demo-data";
import type { AlertRule } from "@ticket-agent/contracts";
import { createAdminClient } from "@/lib/supabase/server";
import Dashboard from "./ui/dashboard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function loadDashboard(userId: string, demo: boolean) {
  if (demo) {
    return {
      events: demoEvents,
      listings: demoListings,
      history: demoHistory,
      watchlist: [],
      alerts: demoAlerts,
      alertsEnabled: true,
      extensionConnected: false,
      extensionLastActiveAt: null
    };
  }

  const supabase = createAdminClient();
  const listingPageSize = 1000;
  const listingRequest = (async () => {
    const first = await supabase
      .from("listings")
      .select("*")
      .eq("owner_id", userId)
      .eq("available", true)
      .order("observed_at", { ascending: false })
      .range(0, listingPageSize - 1);
    if (first.error) return { data: null, error: first.error };
    const rows = [...(first.data ?? [])];
    if (rows.length < listingPageSize) return { data: rows, error: null };

    for (let offset = listingPageSize; offset < 25_000; offset += listingPageSize) {
      const response = await supabase
        .from("listings")
        .select("*")
        .eq("owner_id", userId)
        .eq("available", true)
        .order("observed_at", { ascending: false })
        .range(offset, offset + listingPageSize - 1);
      if (response.error) return { data: null, error: response.error };
      const page = response.data ?? [];
      rows.push(...page);
      if (page.length < listingPageSize) break;
    }
    return { data: rows, error: null };
  })();
  const [
    { data: eventRows, error: eventError },
    { data: summaryRows, error: summaryError },
    { data: listingRows, error: listingError },
    { data: observationRows, error: observationError },
    { data: watchRows, error: watchError },
    { data: alertRows, error: alertError },
    { data: profile, error: profileError },
    { data: extensionRows, error: extensionError }
  ] =
    await Promise.all([
      supabase
        .from("events")
        .select("id,mlb_game_pk,opponent,starts_at,venue")
        .eq("home_team", "Atlanta Braves")
        .gte("starts_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
        .order("starts_at"),
      supabase.from("event_summaries").select("*").eq("owner_id", userId),
      listingRequest,
      supabase
        .from("listing_observations")
        .select("source,listing_id,observed_at,price_per_ticket")
        .eq("owner_id", userId)
        .order("observed_at", { ascending: false })
        .limit(2500),
      supabase.from("watchlists").select("source,listing_id").eq("owner_id", userId),
      supabase.from("alert_rules").select("*").eq("owner_id", userId).order("created_at"),
      supabase.from("profiles").select("alerts_enabled").eq("id", userId).single(),
      supabase
        .from("extension_tokens")
        .select("last_used_at,created_at")
        .eq("owner_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
    ]);

  if (eventError) throw eventError;
  if (summaryError) {
    console.warn(JSON.stringify({
      level: "warn",
      msg: "dashboard event summaries unavailable",
      code: summaryError.code,
      error: summaryError.message
    }));
  }
  if (listingError) throw listingError;
  if (observationError) {
    console.warn(JSON.stringify({
      level: "warn",
      msg: "dashboard price history unavailable",
      code: observationError.code,
      error: observationError.message
    }));
  }
  if (watchError) throw watchError;
  if (alertError) throw alertError;
  if (profileError) throw profileError;
  if (extensionError) throw extensionError;

  const summaries = new Map((summaryRows ?? []).map((row) => [row.event_id, row]));
  if (summaryError) {
    for (const row of listingRows ?? []) {
      const summary = summaries.get(row.event_id) ?? {
        event_id: row.event_id,
        inventory_count: 0,
        minimum_price: null,
        trend_percent: null,
        source_freshness: {}
      };
      summary.inventory_count = Number(summary.inventory_count) + 1;
      if (
        row.all_in
        && (
          summary.minimum_price == null
          || Number(row.price_per_ticket) < Number(summary.minimum_price)
        )
      ) {
        summary.minimum_price = row.price_per_ticket;
      }
      const sourceFreshness = summary.source_freshness as Record<string, string>;
      const source = row.source;
      const observedAt = row.observed_at;
      if (source && observedAt) {
        const lastObservedAt = sourceFreshness[source];
        if (!lastObservedAt || lastObservedAt < observedAt) {
          sourceFreshness[source] = observedAt;
        }
      }
      summaries.set(row.event_id, summary);
    }
  }

  const events: DashboardEvent[] = (eventRows ?? []).map((row) => {
    const summary = summaries.get(row.id);
    return {
      id: row.id,
      mlbGamePk: row.mlb_game_pk,
      opponent: row.opponent,
      startsAt: row.starts_at,
      venue: row.venue,
      inventoryCount: summary?.inventory_count ?? 0,
      minimumPrice: summary?.minimum_price ?? null,
      trendPercent: summary?.trend_percent ?? null,
      freshness: summary?.source_freshness ?? {}
    };
  });

  const listings = (listingRows ?? []).map((row) => ({
    source: row.source,
    sourceEventId: row.source_event_id,
    listingId: row.listing_id,
    mlbGamePk: row.mlb_game_pk,
    observedAt: row.observed_at,
    scanId: row.last_scan_id,
    scanCompleteness: row.last_scan_completeness,
    eventName: "Atlanta Braves home game",
    eventDate: null,
    venue: "Truist Park",
    section: row.section,
    row: row.row_label,
    seatFrom: row.seat_from ?? undefined,
    seatTo: row.seat_to ?? undefined,
    quantityMin: row.quantity_min,
    quantityMax: row.quantity_max,
    pricePerTicket: Number(row.price_per_ticket),
    currency: row.currency,
    allIn: row.all_in,
    collectionMode: row.collection_mode ?? "browser_observed",
    priceBasis: row.price_basis ?? (row.all_in ? "all_in" : "unknown"),
    providerObservedAt: row.provider_observed_at ?? null,
    accessible: row.accessible,
    limitedView: row.limited_view,
    notes: Array.isArray(row.notes) ? row.notes : [],
    deepLink: row.deep_link
  }));

  const history: DashboardHistoryPoint[] = [...(observationRows ?? [])]
    .reverse()
    .map((row) => ({
    source: row.source,
    listingId: row.listing_id,
    observedAt: row.observed_at,
    pricePerTicket: Number(row.price_per_ticket)
    }));
  const alerts: AlertRule[] = (alertRows ?? []).map((row) => ({
    id: row.id,
    type: row.rule_type,
    enabled: row.enabled,
    mlbGamePk: events.find((event) => event.id === row.event_id)?.mlbGamePk ?? null,
    source: row.source,
    sectionQuery: row.section_query,
    quantity: row.quantity,
    maxPrice: row.max_price == null ? null : Number(row.max_price),
    accessible: row.accessible,
    emailEnabled: row.email_enabled
  }));

  return {
    events,
    listings,
    history,
    watchlist: (watchRows ?? []).map((row) => `${row.source}:${row.listing_id}`),
    alerts,
    alertsEnabled: profile.alerts_enabled,
    extensionConnected: Boolean(extensionRows?.length),
    extensionLastActiveAt: extensionRows?.[0]?.last_used_at ?? null
  };
}

export default async function Home() {
  let identity;
  try {
    identity = await currentIdentity();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") redirect("/login");
    throw error;
  }
  const data = await loadDashboard(identity.id, identity.demo);
  return (
    <Dashboard
      initialEvents={data.events}
      initialListings={data.listings}
      initialHistory={data.history}
      initialWatchlist={data.watchlist}
      initialAlerts={data.alerts}
      initialAlertsEnabled={data.alertsEnabled}
      extensionConnected={data.extensionConnected}
      extensionLastActiveAt={data.extensionLastActiveAt}
      snapshotAt={new Date().toISOString()}
      identity={identity}
    />
  );
}
