import { randomUUID } from "node:crypto";
import {
  adaptiveScanIntervalMinutes,
  crossPlatformMappingFeedSchema,
  isScanDue,
  MARKETPLACE_SOURCES
} from "@ticket-agent/contracts";
import { requireCronSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { ingestScan } from "@/lib/ingest";
import { processConnectorListingImports } from "@/lib/connector-imports";
import {
  collectStubHubEvent,
  stubHubCollectionCapability
} from "@/lib/providers/stubhub";
import { parseTickPickEventMappings } from "@/lib/providers/tickpick";

type MlbGame = {
  gamePk: number;
  gameDate: string;
  teams: {
    home: { team: { name: string } };
    away: { team: { name: string } };
  };
  venue: { name: string };
};

async function syncBravesSchedule() {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const response = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=144&startDate=${start}&endDate=${end}`,
    { signal: AbortSignal.timeout(12_000), next: { revalidate: 300 } }
  );
  if (!response.ok) throw new Error(`MLB schedule returned ${response.status}`);
  const payload = (await response.json()) as { dates?: Array<{ games?: MlbGame[] }> };
  const games = (payload.dates ?? [])
    .flatMap((date) => date.games ?? [])
    .filter((game) => game.teams.home.team.name === "Atlanta Braves");

  if (!games.length) return 0;
  const supabase = createAdminClient();
  const { error } = await supabase.from("events").upsert(
    games.map((game) => ({
      mlb_game_pk: String(game.gamePk),
      home_team: game.teams.home.team.name,
      away_team: game.teams.away.team.name,
      opponent: game.teams.away.team.name,
      starts_at: game.gameDate,
      venue: game.venue.name
    })),
    { onConflict: "mlb_game_pk" }
  );
  if (error) throw error;
  return games.length;
}

async function collectSeatGeekSummaries() {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return { skipped: true, reason: "SEATGEEK_CLIENT_ID is not set" };
  const response = await fetch(
    `https://api.seatgeek.com/2/events?performers.slug=atlanta-braves&venue.city=Atlanta&datetime_utc.gte=${new Date().toISOString()}&client_id=${encodeURIComponent(clientId)}`,
    { signal: AbortSignal.timeout(12_000), cache: "no-store" }
  );
  if (!response.ok) throw new Error(`SeatGeek returned ${response.status}`);
  const payload = (await response.json()) as {
    events?: Array<{
      id: number;
      datetime_utc: string;
      url?: string;
      stats?: { lowest_price?: number; listing_count?: number; average_price?: number };
    }>;
  };
  const supabase = createAdminClient();
  for (const event of payload.events ?? []) {
    const starts = Date.parse(event.datetime_utc);
    const { data: canonical } = await supabase
      .from("events")
      .select("id")
      .gte("starts_at", new Date(starts - 6 * 60 * 60 * 1000).toISOString())
      .lte("starts_at", new Date(starts + 6 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (!canonical) continue;
    const { data: existing } = await supabase
      .from("source_events")
      .select("summary")
      .eq("source", "SeatGeek")
      .eq("source_event_id", String(event.id))
      .maybeSingle();
    const existingSummary =
      (existing?.summary as Record<string, unknown> | null) ?? {};
    const localBrowserActive =
      existingSummary.collectionMode === "browser_observed" &&
      existingSummary.browserAutomationAllowed === true;
    const connectorActive = existingSummary.collectionMode === "connector_alert";
    await supabase.from("source_events").upsert(
      {
        event_id: canonical.id,
        source: "SeatGeek",
        source_event_id: String(event.id),
        last_observed_at: new Date().toISOString(),
        summary: {
          ...existingSummary,
          ...(event.stats ?? {}),
          ...(event.url ? { url: event.url } : {}),
          collectionMode: localBrowserActive
            ? "browser_observed"
            : connectorActive
              ? "connector_alert"
              : "summary_only",
          priceBasis: localBrowserActive || connectorActive ? "all_in" : "unknown",
          browserAutomationAllowed: localBrowserActive,
          capabilityMessage:
            localBrowserActive
              ? "Exact listing prices are supplied by the authorized local Chrome scanner."
              : connectorActive
              ? "Exact listing prices are supplied by the authorized SeatGeek connector."
              : "SeatGeek public catalog data is event-level only; exact listings require approved listing access."
        }
      },
      { onConflict: "source,source_event_id" }
    );
  }
  return { skipped: false, count: payload.events?.length ?? 0 };
}

type StubHubSourceEvent = {
  event_id: string;
  source_event_id: string;
  summary: Record<string, unknown> | null;
  events: {
    mlb_game_pk: string;
    opponent: string;
    starts_at: string;
    venue: string;
  };
};

async function collectStubHubListings() {
  const capability = stubHubCollectionCapability();
  const supabase = createAdminClient();
  const { data: sourceRows, error: sourceError } = await supabase
    .from("source_events")
    .select("event_id,source_event_id,summary,events!inner(mlb_game_pk,opponent,starts_at,venue)")
    .eq("source", "StubHub")
    .gte("events.starts_at", new Date(Date.now() - 3 * 60 * 60_000).toISOString())
    .lte("events.starts_at", new Date(Date.now() + 45 * 86_400_000).toISOString());
  if (sourceError) throw sourceError;

  const rows = ((sourceRows ?? []) as unknown as StubHubSourceEvent[])
    .sort((left, right) =>
      Date.parse(left.events.starts_at) - Date.parse(right.events.starts_at)
    );
  for (const row of rows) {
    const summary = row.summary ?? {};
    const localBrowserActive =
      summary.collectionMode === "browser_observed" &&
      summary.browserAutomationAllowed === true;
    const desiredCollectionMode = localBrowserActive
      ? "browser_observed"
      : capability.collectionMode;
    const desiredPriceBasis =
      localBrowserActive || capability.configured ? "all_in" : "unknown";
    const capabilityMessage = localBrowserActive
      ? "Exact listing prices are supplied by the authorized local Chrome scanner."
      : capability.configured
        ? "Official application credentials and an approved listings endpoint are configured."
        : "Waiting for StubHub application credentials and approved listing endpoint access.";
    if (
      summary.collectionMode === desiredCollectionMode &&
      summary.priceBasis === desiredPriceBasis &&
      summary.browserAutomationAllowed === localBrowserActive &&
      summary.capabilityMessage === capabilityMessage
    ) continue;
    const { error } = await supabase.from("source_events").update({
      summary: {
        ...summary,
        collectionMode: desiredCollectionMode,
        priceBasis: desiredPriceBasis,
        browserAutomationAllowed: localBrowserActive,
        capabilityMessage
      }
    })
      .eq("source", "StubHub")
      .eq("source_event_id", row.source_event_id);
    if (error) throw error;
  }

  const officialApiRows = rows.filter((row) =>
    !(
      row.summary?.collectionMode === "browser_observed" &&
      row.summary?.browserAutomationAllowed === true
    )
  );

  if (!capability.configured) {
    return {
      skipped: true,
      reason: rows.length !== officialApiRows.length
        ? "Authorized local browser scanner is active; official StubHub API access remains pending"
        : "StubHub exact listing access is pending configuration",
      capability
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { skipped: true, reason: "No private account is configured", capability };

  const { data: alertRows, error: alertError } = await supabase
    .from("alert_rules")
    .select("event_id")
    .eq("owner_id", profile.id)
    .eq("enabled", true);
  if (alertError) throw alertError;
  const hasGlobalAlert = (alertRows ?? []).some((row) => row.event_id == null);
  const priorityEvents = new Set(
    (alertRows ?? []).flatMap((row) =>
      typeof row.event_id === "string" ? [row.event_id] : []
    )
  );
  const { data: latestRows, error: latestError } = await supabase
    .from("scan_runs")
    .select("source_event_id,completed_at")
    .eq("owner_id", profile.id)
    .eq("source", "StubHub")
    .eq("collection_mode", "official_api")
    .order("completed_at", { ascending: false })
    .limit(1000);
  if (latestError) throw latestError;
  const latest = new Map<string, string>();
  for (const row of latestRows ?? []) {
    if (!latest.has(row.source_event_id)) latest.set(row.source_event_id, row.completed_at);
  }

  const due = officialApiRows
    .filter((row) => {
      const interval = adaptiveScanIntervalMinutes(
        row.events.starts_at,
        hasGlobalAlert || priorityEvents.has(row.event_id)
      );
      return isScanDue(latest.get(row.source_event_id), interval);
    })
    .slice(0, 10);

  const results = [];
  for (const row of due) {
    try {
      const batch = await collectStubHubEvent({
        sourceEventId: row.source_event_id,
        mlbGamePk: row.events.mlb_game_pk,
        eventName: `${row.events.opponent} at Atlanta Braves`,
        eventDate: row.events.starts_at,
        venue: row.events.venue
      });
      const skippedWithoutAllInPrice = batch.skippedWithoutAllInPrice;
      const ingested = await ingestScan(batch, profile.id);
      results.push({
        sourceEventId: row.source_event_id,
        ok: true,
        skippedWithoutAllInPrice,
        ...ingested
      });
    } catch (error) {
      results.push({
        sourceEventId: row.source_event_id,
        ok: false,
        error: error instanceof Error ? error.message : "StubHub collection failed"
      });
    }
  }
  return { skipped: false, capability, due: due.length, results };
}

async function collectCrossPlatformMappings() {
  const url = process.env.MARKETPLACE_MAPPING_FEED_URL;
  const token = process.env.MARKETPLACE_MAPPING_FEED_TOKEN;
  if (!url || !token) {
    return {
      skipped: true,
      reason: "Authorized cross-platform mapping feed is not configured"
    };
  }
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Marketplace mapping feed returned ${response.status}`);
  }
  const mappings = crossPlatformMappingFeedSchema.parse(await response.json());
  const supabase = createAdminClient();
  let imported = 0;
  let missingEvents = 0;
  for (const mapping of mappings) {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("mlb_game_pk", mapping.mlbGamePk)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) {
      missingEvents += 1;
      continue;
    }
    for (const source of MARKETPLACE_SOURCES) {
      const reference = mapping.sources[source];
      if (!reference) continue;
      const { data: existing, error: existingError } = await supabase
        .from("source_events")
        .select("summary")
        .eq("source", source)
        .eq("source_event_id", reference.sourceEventId)
        .maybeSingle();
      if (existingError) throw existingError;
      const { error } = await supabase.from("source_events").upsert({
        event_id: event.id,
        source,
        source_event_id: reference.sourceEventId,
        summary: {
          ...((existing?.summary as Record<string, unknown> | null) ?? {}),
          ...(reference.url ? { url: reference.url } : {}),
          mappingOrigin: "authorized-cross-platform-feed"
        }
      }, { onConflict: "source,source_event_id" });
      if (error) throw error;
      imported += 1;
    }
  }
  return { skipped: false, records: mappings.length, imported, missingEvents };
}

function newYorkDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function collectTickPickMappings() {
  const response = await fetch(
    "https://www.tickpick.com/baseball/atlanta-braves-tickets/",
    {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TicketAgent/0.2; event metadata only)"
      },
      signal: AbortSignal.timeout(20_000),
      next: { revalidate: 21_600 }
    }
  );
  if (!response.ok) {
    throw new Error(`TickPick event catalog returned ${response.status}`);
  }
  const mappings = parseTickPickEventMappings(await response.text());
  if (!mappings.length) {
    return { skipped: true, reason: "TickPick event catalog exposed no Braves home mappings" };
  }

  const supabase = createAdminClient();
  const [{ data: events, error: eventsError }, { data: existing, error: existingError }] =
    await Promise.all([
      supabase
        .from("events")
        .select("id,starts_at")
        .gte("starts_at", new Date(Date.now() - 3 * 60 * 60_000).toISOString())
        .lte("starts_at", new Date(Date.now() + 120 * 86_400_000).toISOString()),
      supabase
        .from("source_events")
        .select("source_event_id,summary")
        .eq("source", "TickPick")
    ]);
  if (eventsError) throw eventsError;
  if (existingError) throw existingError;

  const eventByDate = new Map(
    (events ?? []).map((event) => [newYorkDate(event.starts_at), event.id])
  );
  const summaryBySourceId = new Map(
    (existing ?? []).map((row) => [
      row.source_event_id,
      (row.summary as Record<string, unknown> | null) ?? {}
    ])
  );
  const checkedAt = new Date().toISOString();
  const records = mappings.flatMap((mapping) => {
    const eventId = eventByDate.get(mapping.startsOn);
    if (!eventId) return [];
    return [{
      event_id: eventId,
      source: "TickPick" as const,
      source_event_id: mapping.sourceEventId,
      summary: {
        ...(summaryBySourceId.get(mapping.sourceEventId) ?? {}),
        url: mapping.url,
        mappingOrigin: "tickpick_public_event_catalog",
        mappingLastCheckedAt: checkedAt,
        collectionMode: "browser_observed",
        priceBasis: "all_in",
        capabilityMessage:
          "TickPick catalog supplies event metadata only; the authorized local Chrome scanner supplies listing inventory."
      }
    }];
  });
  if (!records.length) {
    return { skipped: true, reason: "TickPick mappings did not match the Braves schedule" };
  }
  const { error } = await supabase
    .from("source_events")
    .upsert(records, { onConflict: "source,source_event_id" });
  if (error) throw error;
  return { skipped: false, discovered: mappings.length, imported: records.length };
}

async function collectTickPickFeed() {
  const url = process.env.TICKPICK_FEED_URL;
  const token = process.env.TICKPICK_FEED_TOKEN;
  if (!url || !token) return { skipped: true, reason: "Affiliate feed is not configured" };
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`TickPick feed returned ${response.status}`);
  const payload = await response.json();
  const batches = Array.isArray(payload) ? payload : [payload];
  const supabase = createAdminClient();
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).maybeSingle();
  if (!profile) return { skipped: true, reason: "No private account is configured" };
  const results = [];
  for (const batch of batches) {
    results.push(await ingestScan({
      ...batch,
      scanId: batch.scanId ?? randomUUID(),
      extensionVersion: batch.extensionVersion ?? "tickpick-affiliate-feed"
    }, profile.id));
  }
  return { skipped: false, received: batches.length, results };
}

export async function POST(request: Request) {
  if (!(await requireCronSecret(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [
      games,
      seatgeek,
      mappings,
      tickpickMappings,
      tickpick,
      stubhub,
      connectorImports
    ] = await Promise.all([
      syncBravesSchedule(),
      collectSeatGeekSummaries(),
      collectCrossPlatformMappings(),
      collectTickPickMappings(),
      collectTickPickFeed(),
      collectStubHubListings(),
      processConnectorListingImports()
    ]);
    return Response.json({
      ok: true,
      games,
      seatgeek,
      mappings,
      tickpickMappings,
      tickpick,
      stubhub,
      connectorImports,
      collectedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Collector failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Collector failed" }, { status: 500 });
  }
}
