import type { AutoScanJob } from "./types";

export const PRIORITY_RESCAN_MS = 5 * 60_000;
export const NEXT_GAME_RESCAN_MS = 15 * 60_000;
export const BACKGROUND_RESCAN_MS = 6 * 60 * 60_000;

export function autoScanJobKey(job: Pick<AutoScanJob, "source" | "sourceEventId">) {
  return `${job.source}:${job.sourceEventId}`;
}

export function jobCadenceMs(
  job: AutoScanJob,
  nextGamePk: string | null
) {
  if (job.priority) return PRIORITY_RESCAN_MS;
  if (nextGamePk && job.mlbGamePk === nextGamePk) return NEXT_GAME_RESCAN_MS;
  return BACKGROUND_RESCAN_MS;
}

export function selectAutoScanJobs(
  jobs: AutoScanJob[],
  lastScannedAt: Record<string, number>,
  now = Date.now(),
  limit = 4
) {
  const sorted = [...jobs].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.source.localeCompare(b.source)
  );
  const nextGamePk = sorted[0]?.mlbGamePk ?? null;

  return sorted
    .filter((job) => {
      const lastScan = lastScannedAt[autoScanJobKey(job)] ?? 0;
      return now - lastScan >= jobCadenceMs(job, nextGamePk);
    })
    .sort((a, b) => {
      const aRank = a.priority ? 0 : a.mlbGamePk === nextGamePk ? 1 : 2;
      const bRank = b.priority ? 0 : b.mlbGamePk === nextGamePk ? 1 : 2;
      return (
        aRank - bRank ||
        (lastScannedAt[autoScanJobKey(a)] ?? 0) -
          (lastScannedAt[autoScanJobKey(b)] ?? 0) ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.source.localeCompare(b.source)
      );
    })
    .slice(0, limit);
}
