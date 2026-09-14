import { scanBatchSchema, type ScanBatch } from "@ticket-agent/contracts";
import type { ScanJob, WorkerConfig } from "./types";

type JobsResponse = {
  jobs?: unknown;
};

function headers(config: WorkerConfig) {
  return {
    Authorization: `Bearer ${config.extensionToken}`,
    "X-Extension-Id": "ticket-agent-crawlee-worker"
  };
}

export async function loadJobs(config: WorkerConfig): Promise<ScanJob[]> {
  if (config.urls.length) return config.urls.slice(0, config.maxJobs);
  const response = await fetch(
    `${config.apiBaseUrl}/api/v1/extension/jobs?horizonDays=${config.horizonDays}`,
    { headers: headers(config) }
  );
  if (!response.ok) {
    throw new Error(`Could not load scan jobs (${response.status})`);
  }
  const payload = await response.json() as JobsResponse;
  if (!Array.isArray(payload.jobs)) {
    throw new Error("Scan-jobs response did not contain a jobs array");
  }
  return (payload.jobs as ScanJob[]).slice(0, config.maxJobs);
}

export async function uploadBatch(config: WorkerConfig, raw: ScanBatch) {
  const batch = scanBatchSchema.parse(raw);
  if (config.dryRun) {
    return {
      dryRun: true,
      listingCount: batch.listings.length
    };
  }
  if (!config.extensionToken) {
    throw new Error("TICKET_AGENT_EXTENSION_TOKEN is required when dry-run mode is disabled");
  }
  const response = await fetch(`${config.apiBaseUrl}/api/v1/scans`, {
    method: "POST",
    headers: {
      ...headers(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(batch)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Scan upload failed (${response.status})${
        result && typeof result === "object" && "error" in result
          ? `: ${String(result.error)}`
          : ""
      }`
    );
  }
  return result;
}
