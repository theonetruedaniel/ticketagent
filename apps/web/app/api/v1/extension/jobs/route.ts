import { authenticateExtension } from "@/lib/extension-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  adaptiveScanIntervalMinutes,
  isScanDue
} from "@ticket-agent/contracts";

type SourceEventRow = {
  event_id: string;
  source: "SeatGeek" | "StubHub" | "TickPick" | "GameTime";
  source_event_id: string;
  summary: {
    url?: unknown;
    collectionMode?: unknown;
    browserAutomationAllowed?: unknown;
    browserFailureStreak?: unknown;
    browserLastAttemptAt?: unknown;
  } | null;
  events: {
    mlb_game_pk: string;
    opponent: string;
    starts_at: string;
  };
};

type LatestScanRow = {
  source: SourceEventRow["source"];
  source_event_id: string;
  completed_at: string;
  status: "complete" | "partial" | "blocked" | "error";
};

export async function GET(request: Request) {
  const extension = await authenticateExtension(request);
  if (!extension) {
    return Response.json({ error: "Invalid or revoked extension token" }, { status: 401 });
  }

  const requestedHorizon = Number(new URL(request.url).searchParams.get("horizonDays") ?? 14);
  const horizonDays = Math.min(45, Math.max(1, Number.isFinite(requestedHorizon) ? requestedHorizon : 14));
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const supabase = createAdminClient();
  const [
    { data, error },
    { data: alertRows, error: alertError },
    { data: scanRows, error: scanError }
  ] =
    await Promise.all([
      supabase
        .from("source_events")
        .select("event_id,source,source_event_id,summary,events!inner(mlb_game_pk,opponent,starts_at)")
        .gte("events.starts_at", new Date(now.getTime() - 3 * 60 * 60_000).toISOString())
        .lte("events.starts_at", horizon.toISOString()),
      supabase
        .from("alert_rules")
        .select("event_id")
        .eq("owner_id", extension.userId)
        .eq("enabled", true),
      supabase
        .from("scan_runs")
        .select("source,source_event_id,completed_at,status")
        .eq("owner_id", extension.userId)
        .order("completed_at", { ascending: false })
        .limit(2000)
    ]);

  if (error || alertError || scanError) {
    console.error("Could not load extension scan jobs", error ?? alertError ?? scanError);
    return Response.json({ error: "Could not load scan jobs" }, { status: 500 });
  }

  const priorityEventIds = new Set(
    (alertRows ?? []).flatMap((row) =>
      typeof row.event_id === "string" ? [row.event_id] : []
    )
  );
  const hasGlobalAlert = (alertRows ?? []).some((row) => row.event_id == null);
  const latestBySourceEvent = new Map<string, LatestScanRow>();
  for (const row of (scanRows ?? []) as LatestScanRow[]) {
    const key = `${row.source}:${row.source_event_id}`;
    if (!latestBySourceEvent.has(key)) latestBySourceEvent.set(key, row);
  }

  const sourceRows = (data ?? []) as unknown as SourceEventRow[];
  const nextGamePk = [...sourceRows]
    .sort((left, right) =>
      Date.parse(left.events.starts_at) - Date.parse(right.events.starts_at)
    )[0]?.events.mlb_game_pk ?? null;

  const jobs = sourceRows
    .flatMap((row) => {
      const url = typeof row.summary?.url === "string" ? row.summary.url : null;
      if (!url) return [];
      const restrictedSource = row.source === "SeatGeek" || row.source === "StubHub";
      if (restrictedSource && extension.browserAutomationAllowed !== true) return [];
      if (restrictedSource && row.summary?.browserAutomationAllowed !== true) return [];
      if (
        row.summary?.collectionMode === "summary_only" ||
        row.summary?.collectionMode === "access_pending" ||
        row.summary?.collectionMode === "official_api" ||
        row.summary?.collectionMode === "licensed_feed" ||
        row.summary?.collectionMode === "connector_alert"
      ) return [];
      const priority =
        hasGlobalAlert ||
        priorityEventIds.has(row.event_id) ||
        row.events.mlb_game_pk === nextGamePk;
      const latest = latestBySourceEvent.get(`${row.source}:${row.source_event_id}`);
      const baseInterval = adaptiveScanIntervalMinutes(
        row.events.starts_at,
        priority,
        now
      );
      const intervalMinutes =
        latest?.status === "blocked" ||
        latest?.status === "error" ||
        Number(row.summary?.browserFailureStreak ?? 0) >= 2
          ? Math.max(baseInterval, priority ? 60 : 360)
          : baseInterval;
      if (!isScanDue(latest?.completed_at, intervalMinutes, now)) return [];
      const lastScannedAt = latest?.completed_at ?? null;
      const overdueMinutes = lastScannedAt
        ? Math.max(0, (now.getTime() - Date.parse(lastScannedAt)) / 60_000 - intervalMinutes)
        : Number.MAX_SAFE_INTEGER;
      return [{
        source: row.source,
        sourceEventId: row.source_event_id,
        url,
        mlbGamePk: row.events.mlb_game_pk,
        opponent: row.events.opponent,
        startsAt: row.events.starts_at,
        priority,
        intervalMinutes,
        lastScannedAt,
        overdueMinutes
      }];
    })
    .sort((a, b) =>
      Number(b.priority) - Number(a.priority)
      || b.overdueMinutes - a.overdueMinutes
      || Date.parse(a.startsAt) - Date.parse(b.startsAt)
      || a.source.localeCompare(b.source)
    )
    .map(({ overdueMinutes: _overdueMinutes, ...job }) => job);

  return Response.json({ jobs, horizonDays, generatedAt: new Date().toISOString() });
}
