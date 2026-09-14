import type {
  MarketplaceSource,
  ScanBatch
} from "@ticket-agent/contracts";

export type ScanJob = {
  source: MarketplaceSource;
  sourceEventId: string;
  url: string;
  mlbGamePk: string;
  opponent: string;
  startsAt: string;
  priority: boolean;
  intervalMinutes?: number;
  lastScannedAt?: string | null;
};

export type WorkerConfig = {
  apiBaseUrl: string;
  extensionToken: string;
  horizonDays: number;
  maxConcurrency: number;
  maxJobs: number;
  maxScanPasses: number;
  navigationTimeoutSeconds: number;
  scanDelayMs: number;
  headless: boolean;
  dryRun: boolean;
  urls: ScanJob[];
};

export type CandidateCard = {
  text: string;
  deepLink: string;
  nativeId: string | null;
};

export type PageSnapshot = {
  title: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  bodyText: string;
  candidates: CandidateCard[];
  embeddedPayloads: unknown[];
  explicitEmptyInventory: boolean;
};

export type ScanResult = {
  batch: ScanBatch;
  diagnostic: {
    pageTitle: string;
    passes: number;
    capturedResponses: number;
  };
};
