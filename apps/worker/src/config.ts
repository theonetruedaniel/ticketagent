import {
  marketplaceSourceSchema
} from "@ticket-agent/contracts";
import type { ScanJob, WorkerConfig } from "./types";

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  const parsed = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  if (/^(0|false|no)$/i.test(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function parsePilotJobs(raw: string | undefined): ScanJob[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("TICKET_AGENT_WORKER_URLS must be a JSON array");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`TICKET_AGENT_WORKER_URLS[${index}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    const source = marketplaceSourceSchema.parse(row.source);
    const sourceEventId = String(row.sourceEventId ?? "").trim();
    const url = String(row.url ?? "").trim();
    const mlbGamePk = String(row.mlbGamePk ?? "").trim();
    const opponent = String(row.opponent ?? "").trim();
    const startsAt = String(row.startsAt ?? "").trim();
    if (!sourceEventId || !url || !mlbGamePk || !opponent || !startsAt) {
      throw new Error(
        `TICKET_AGENT_WORKER_URLS[${index}] requires sourceEventId, url, mlbGamePk, opponent, and startsAt`
      );
    }
    new URL(url);
    if (!Number.isFinite(Date.parse(startsAt))) {
      throw new Error(`TICKET_AGENT_WORKER_URLS[${index}].startsAt must be an ISO date`);
    }
    return {
      source,
      sourceEventId,
      url,
      mlbGamePk,
      opponent,
      startsAt: new Date(startsAt).toISOString(),
      priority: Boolean(row.priority)
    };
  });
}

export function loadConfig(): WorkerConfig {
  const apiBaseUrl =
    process.env.TICKET_AGENT_API_BASE_URL?.trim() ??
    "http://localhost:3000";
  new URL(apiBaseUrl);
  const urls = parsePilotJobs(process.env.TICKET_AGENT_WORKER_URLS);
  const extensionToken =
    process.env.TICKET_AGENT_EXTENSION_TOKEN?.trim() ??
    process.env.DEV_EXTENSION_TOKEN?.trim() ??
    "";
  if (!extensionToken && !urls.length) {
    throw new Error(
      "Set TICKET_AGENT_EXTENSION_TOKEN to load scheduled jobs, or TICKET_AGENT_WORKER_URLS for a bounded pilot"
    );
  }
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    extensionToken,
    horizonDays: integer("TICKET_AGENT_WORKER_HORIZON_DAYS", 14, 1, 45),
    maxConcurrency: integer("TICKET_AGENT_WORKER_MAX_CONCURRENCY", 2, 1, 8),
    maxJobs: integer("TICKET_AGENT_WORKER_MAX_JOBS", 8, 1, 100),
    maxScanPasses: integer("TICKET_AGENT_WORKER_MAX_SCAN_PASSES", 48, 1, 100),
    navigationTimeoutSeconds: integer(
      "TICKET_AGENT_WORKER_NAVIGATION_TIMEOUT_SECONDS",
      60,
      10,
      180
    ),
    scanDelayMs: integer("TICKET_AGENT_WORKER_SCAN_DELAY_MS", 550, 100, 5000),
    headless: boolean("TICKET_AGENT_WORKER_HEADLESS", true),
    dryRun: boolean("TICKET_AGENT_WORKER_DRY_RUN", true),
    urls
  };
}
