import type { AlertRule, NormalizedListing, ScanBatch } from "@ticket-agent/contracts";

export type ExtensionSettings = {
  apiBaseUrl: string;
  extensionToken: string | null;
  contributionEnabled: boolean;
  consentAcceptedAt: string | null;
  autoScanEnabled: boolean;
  autoScanHorizonDays: number;
};

export type AutoScanJob = {
  source: "SeatGeek" | "StubHub" | "TickPick" | "GameTime";
  sourceEventId: string;
  url: string;
  mlbGamePk: string;
  opponent: string;
  startsAt: string;
  priority: boolean;
};

export type ScanRecord = {
  batch: ScanBatch;
  receivedAt: string;
};

export type ExtensionState = {
  settings: ExtensionSettings;
  listings: NormalizedListing[];
  alerts: AlertRule[];
  watchlist: string[];
  scans: ScanRecord[];
  currentStatus: {
    source: string | null;
    state: "idle" | "scanning" | "complete" | "blocked" | "error";
    message: string;
    progress: number;
  };
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "http://localhost:3000",
  extensionToken: null,
  contributionEnabled: false,
  consentAcceptedAt: null,
  autoScanEnabled: true,
  autoScanHorizonDays: 14
};
