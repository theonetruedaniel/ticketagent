import { currentIdentity } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const identity = await currentIdentity();
    if (identity.demo) {
      return Response.json({ mode: "demo" });
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const [
      { count: futureEvents, error: futureEventError },
      { count: mappedSources, error: mappedSourceError },
      { count: scans, error: countScanError },
      { count: listings, error: listingError },
      { count: availableListings, error: availableListingError },
      { count: verifiedAllInListings, error: verifiedAllInError },
      { data: latestScans, error: scanError },
      { data: latestTokens, error: tokenError },
      { data: sourceCapabilities, error: capabilityError }
    ] = await Promise.all([
      supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .gte("starts_at", now),
      supabase
        .from("source_events")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("scan_runs")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", identity.id),
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", identity.id),
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", identity.id)
        .eq("available", true),
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", identity.id)
        .eq("available", true)
        .eq("price_basis", "all_in"),
      supabase
        .from("scan_runs")
        .select(
          "source,status,completeness,collection_mode,listing_count,completed_at,status_message,extension_version"
        )
        .eq("owner_id", identity.id)
        .order("completed_at", { ascending: false })
        .limit(12),
      supabase
        .from("extension_tokens")
        .select("device_name,created_at,last_used_at,revoked_at,expires_at")
        .eq("owner_id", identity.id)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("source_events")
        .select("source,source_event_id,last_observed_at,summary,events!inner(starts_at)")
        .gte("events.starts_at", now)
        .order("last_observed_at", { ascending: false, nullsFirst: false })
        .limit(1000)
    ]);

    if (futureEventError) throw futureEventError;
    if (mappedSourceError) throw mappedSourceError;
    if (countScanError) throw countScanError;
    if (listingError) throw listingError;
    if (availableListingError) throw availableListingError;
    if (verifiedAllInError) throw verifiedAllInError;
    if (scanError) throw scanError;
    if (tokenError) throw tokenError;
    if (capabilityError) throw capabilityError;

    const healthBySource = new Map<string, {
      source: string;
      collectionMode: string;
      priceBasis: string;
      lastObservedAt: string | null;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      runtimeOrigin: string;
      browserFailureStreak: number;
      stale: boolean;
      mappedEvents: number;
      message: string | null;
    }>();
    for (const row of sourceCapabilities ?? []) {
      const summary = row.summary && typeof row.summary === "object"
        ? row.summary as Record<string, unknown>
        : {};
      const previous = healthBySource.get(row.source);
      const observedAt = typeof row.last_observed_at === "string" ? row.last_observed_at : null;
      const lastAttemptAt = typeof summary.browserLastAttemptAt === "string"
        ? summary.browserLastAttemptAt
        : null;
      const lastSuccessAt = typeof summary.browserLastSuccessAt === "string"
        ? summary.browserLastSuccessAt
        : observedAt;
      const previousSuccess = previous?.lastSuccessAt;
      const newestSuccess =
        !previousSuccess ||
        (lastSuccessAt && Date.parse(lastSuccessAt) > Date.parse(previousSuccess))
          ? lastSuccessAt
          : previousSuccess;
      const runtimeOrigin = previous?.runtimeOrigin === "local_chrome"
        ? previous.runtimeOrigin
        : typeof summary.browserRuntimeOrigin === "string"
          ? summary.browserRuntimeOrigin
          : typeof summary.collectionMode === "string"
            ? summary.collectionMode
            : "unknown";
      healthBySource.set(row.source, {
        source: row.source,
        collectionMode: typeof summary.collectionMode === "string"
          ? summary.collectionMode
          : "browser_observed",
        priceBasis: typeof summary.priceBasis === "string" ? summary.priceBasis : "unknown",
        lastObservedAt:
          !previous?.lastObservedAt ||
          (observedAt && Date.parse(observedAt) > Date.parse(previous.lastObservedAt))
            ? observedAt
            : previous.lastObservedAt,
        lastAttemptAt:
          !previous?.lastAttemptAt ||
          (lastAttemptAt && Date.parse(lastAttemptAt) > Date.parse(previous.lastAttemptAt))
            ? lastAttemptAt
            : previous.lastAttemptAt,
        lastSuccessAt: newestSuccess,
        runtimeOrigin,
        browserFailureStreak: Math.max(
          previous?.browserFailureStreak ?? 0,
          Number(summary.browserFailureStreak ?? 0)
        ),
        stale:
          typeof newestSuccess !== "string" ||
          Date.now() - Date.parse(newestSuccess) > 12 * 60_000,
        mappedEvents: (previous?.mappedEvents ?? 0) + 1,
        message: typeof summary.browserHeartbeatMessage === "string"
          ? summary.browserHeartbeatMessage
          : typeof summary.capabilityMessage === "string"
            ? summary.capabilityMessage
          : previous?.message ?? null
      });
    }

    return Response.json({
      checkedAt: now,
      futureEvents: futureEvents ?? 0,
      mappedSources: mappedSources ?? 0,
      scans: scans ?? 0,
      listings: listings ?? 0,
      availableListings: availableListings ?? 0,
      verifiedAllInListings: verifiedAllInListings ?? 0,
      sourceHealth: [...healthBySource.values()],
      latestScans: latestScans ?? [],
      latestTokens: latestTokens ?? []
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Production status check failed", error);
    return Response.json({ error: "Could not load production status" }, { status: 500 });
  }
}
