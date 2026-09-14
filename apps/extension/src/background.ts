import {
  alertMatchesListing,
  alertRuleSchema,
  dealScore,
  isPriorityClubListing,
  PRIORITY_CLUB_ALERT_KEY,
  type NormalizedListing,
  type ScanBatch,
  scanBatchSchema
} from "@ticket-agent/contracts";
import {
  listingStorageKey,
  reconcileLocalListings
} from "./scan-session";
import {
  autoScanJobKey,
  selectAutoScanJobs
} from "./auto-scan";
import {
  DEFAULT_SETTINGS,
  type AutoScanJob,
  type ExtensionState
} from "./types";

const KEYS = {
  settings: "settings",
  listings: "listings",
  alerts: "alerts",
  watchlist: "watchlist",
  scans: "scans",
  status: "status",
  notificationCooldowns: "notificationCooldowns",
  notificationLinks: "notificationLinks",
  autoScanLastRun: "autoScanLastRun",
  providerHealth: "providerHealth"
} as const;

const LOCAL_ALERT_COOLDOWN_MS = 15 * 60_000;
const AUTO_SCAN_ALARM = "automatic-marketplace-scan";
const AUTO_SCAN_JOB_LIMIT = 8;
const TAB_LOAD_TIMEOUT_MS = 30_000;
const TAB_SCAN_TIMEOUT_MS = 50_000;
let automaticScanInProgress = false;

type ProviderHealth = Record<string, {
  failureStreak: number;
  outageNotified: boolean;
  staleNotified: boolean;
  monitoringStartedAt: number;
  lastSuccessAt: number | null;
}>;

function defaultProviderHealth(now = Date.now()) {
  return {
    failureStreak: 0,
    outageNotified: false,
    staleNotified: false,
    monitoringStartedAt: now,
    lastSuccessAt: null
  };
}

async function updateProviderHealthNotice(batch: ScanBatch) {
  if (batch.source !== "SeatGeek" && batch.source !== "StubHub") return;
  const stored = await chrome.storage.local.get(KEYS.providerHealth);
  const health = {
    ...((stored[KEYS.providerHealth] as ProviderHealth | undefined) ?? {})
  };
  const key = `${batch.source}:${batch.sourceEventId}`;
  const previous = health[key] ?? defaultProviderHealth();
  const successful = batch.status === "complete" && batch.completeness === "full";
  const failed =
    batch.status === "blocked" ||
    batch.status === "error" ||
    batch.status === "partial";
  const next = { ...previous };

  if (successful) {
    if (previous.outageNotified || previous.staleNotified) {
      await chrome.notifications.create(`recovery:${key}`, {
        type: "basic",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' rx='24' fill='%232F9E44'/><text x='64' y='82' text-anchor='middle' font-size='64' fill='white'>A</text></svg>",
        title: `${batch.source} monitoring recovered`,
        message: "The local five-minute ticket scanner completed successfully again.",
        priority: 1
      });
    }
    next.failureStreak = 0;
    next.outageNotified = false;
    next.staleNotified = false;
    next.lastSuccessAt = Date.parse(batch.completedAt);
  } else if (failed) {
    next.failureStreak = previous.failureStreak + 1;
    if (next.failureStreak >= 2 && !previous.outageNotified) {
      await chrome.notifications.create(`outage:${key}`, {
        type: "basic",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' rx='24' fill='%23CE1141'/><text x='64' y='82' text-anchor='middle' font-size='64' fill='white'>A</text></svg>",
        title: `${batch.source} monitoring outage`,
        message: batch.statusMessage ?? "Two consecutive local browser scans failed.",
        priority: 2
      });
      next.outageNotified = true;
    }
  }
  health[key] = next;
  await chrome.storage.local.set({ [KEYS.providerHealth]: health });
}

async function reportStalePriorityCoverage(jobs: AutoScanJob[]) {
  const restricted = jobs.filter((job) =>
    job.priority && (job.source === "SeatGeek" || job.source === "StubHub")
  );
  if (!restricted.length) return;
  const stored = await chrome.storage.local.get(KEYS.providerHealth);
  const health = {
    ...((stored[KEYS.providerHealth] as ProviderHealth | undefined) ?? {})
  };
  const now = Date.now();
  for (const job of restricted) {
    const key = `${job.source}:${job.sourceEventId}`;
    const state = health[key] ?? defaultProviderHealth(now);
    const freshnessAnchor = state.lastSuccessAt ?? state.monitoringStartedAt;
    if (now - freshnessAnchor > 12 * 60_000 && !state.staleNotified) {
      await chrome.notifications.create(`stale:${key}`, {
        type: "basic",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' rx='24' fill='%23F08C00'/><text x='64' y='82' text-anchor='middle' font-size='64' fill='white'>A</text></svg>",
        title: `${job.source} coverage is stale`,
        message: `No complete scan for ${job.opponent} in the last 12 minutes.`,
        priority: 2
      });
      state.staleNotified = true;
    }
    health[key] = state;
  }
  await chrome.storage.local.set({ [KEYS.providerHealth]: health });
}

async function getState(): Promise<ExtensionState> {
  const stored = (await chrome.storage.local.get(Object.values(KEYS))) as Partial<
    Record<(typeof KEYS)[keyof typeof KEYS], unknown>
  >;
  const listings = (stored[KEYS.listings] as ExtensionState["listings"]) ?? [];
  const storedWatchlist = (stored[KEYS.watchlist] as ExtensionState["watchlist"]) ?? [];
  const watchlist = storedWatchlist.map((storedId) => {
    const legacyListing = listings.find((listing) => listing.listingId === storedId);
    return legacyListing ? listingStorageKey(legacyListing) : storedId;
  });
  return {
    settings: { ...DEFAULT_SETTINGS, ...((stored[KEYS.settings] as Partial<ExtensionState["settings"]>) ?? {}) },
    listings,
    alerts: (stored[KEYS.alerts] as ExtensionState["alerts"]) ?? [],
    watchlist,
    scans: (stored[KEYS.scans] as ExtensionState["scans"]) ?? [],
    currentStatus: (stored[KEYS.status] as ExtensionState["currentStatus"]) ?? {
      source: null,
      state: "idle",
      message: "Open a Braves home-game listing page",
      progress: 0
    }
  };
}

async function updateStatus(status: ExtensionState["currentStatus"]) {
  await chrome.storage.local.set({ [KEYS.status]: status });
  await chrome.runtime.sendMessage({ type: "STATE_UPDATED" }).catch(() => undefined);
}

async function fireLocalAlerts(
  alerts: ExtensionState["alerts"],
  listings: NormalizedListing[],
  previous: Map<string, NormalizedListing>
) {
  const now = Date.now();
  const stored = await chrome.storage.local.get([
    KEYS.notificationCooldowns,
    KEYS.notificationLinks
  ]);
  const cooldowns = {
    ...((stored[KEYS.notificationCooldowns] as Record<string, number> | undefined) ?? {})
  };
  const notificationLinks = {
    ...((stored[KEYS.notificationLinks] as Record<string, string> | undefined) ?? {})
  };
  for (const [key, firedAt] of Object.entries(cooldowns)) {
    if (now - firedAt > 24 * 60 * 60_000) delete cooldowns[key];
  }

  const priorityListingKeys = new Set<string>();
  const priorityMatches = listings
    .filter(isPriorityClubListing)
    .sort((a, b) => a.pricePerTicket - b.pricePerTicket);
  for (const listing of priorityMatches) {
    const storageKey = listingStorageKey(listing);
    priorityListingKeys.add(storageKey);
    const cooldownKey = `${PRIORITY_CLUB_ALERT_KEY}:${storageKey}`;
    if (now - (cooldowns[cooldownKey] ?? 0) < LOCAL_ALERT_COOLDOWN_MS) continue;
    const notificationId = `alert:${crypto.randomUUID()}`;
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' rx='24' fill='%23CE1141'/><text x='64' y='82' text-anchor='middle' font-size='64' fill='white'>A</text></svg>",
      title: `PRIORITY: ${listing.section} for $${listing.pricePerTicket}`,
      message: `${listing.eventName} · ${listing.quantityMin}-${listing.quantityMax} tickets · ${listing.allIn ? "all-in" : "fees may vary"}`,
      priority: 2
    });
    cooldowns[cooldownKey] = now;
    notificationLinks[notificationId] = listing.deepLink;
  }

  for (const alert of alerts) {
    const matches = listings.filter((listing) => {
      if (priorityListingKeys.has(listingStorageKey(listing))) return false;
      const old = previous.get(listingStorageKey(listing));
      return alertMatchesListing(alert, listing, {
        isNew: !old,
        previousPrice: old?.pricePerTicket
      });
    });
    if (!matches.length) continue;
    const best = [...matches].sort((a, b) => a.pricePerTicket - b.pricePerTicket)[0]!;
    const cooldownKey = `${alert.id}:${listingStorageKey(best)}`;
    if (now - (cooldowns[cooldownKey] ?? 0) < LOCAL_ALERT_COOLDOWN_MS) continue;
    const notificationId = `alert:${crypto.randomUUID()}`;
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' rx='24' fill='%23CE1141'/><text x='64' y='82' text-anchor='middle' font-size='64' fill='white'>A</text></svg>",
      title: `${best.source}: ${best.section} for $${best.pricePerTicket}`,
      message: `${best.eventName} · ${best.quantityMin}-${best.quantityMax} tickets · ${best.allIn ? "all-in" : "fees may vary"}`,
      priority: 2
    });
    cooldowns[cooldownKey] = now;
    notificationLinks[notificationId] = best.deepLink;
  }
  await chrome.storage.local.set({
    [KEYS.notificationCooldowns]: cooldowns,
    [KEYS.notificationLinks]: notificationLinks
  });
}

async function uploadScan(batch: unknown, state: ExtensionState) {
  if (!state.settings.contributionEnabled || !state.settings.extensionToken) return;
  const response = await fetch(`${state.settings.apiBaseUrl.replace(/\/$/, "")}/api/v1/scans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.settings.extensionToken}`,
      "X-Extension-Id": chrome.runtime.id
    },
    body: JSON.stringify(batch)
  });
  if (!response.ok) throw new Error(`Dashboard upload failed (${response.status})`);
}

async function syncPrivateResource(
  state: ExtensionState,
  path: string,
  method: "POST" | "DELETE",
  payload?: unknown
) {
  if (!state.settings.extensionToken || !state.settings.contributionEnabled) return;
  const response = await fetch(`${state.settings.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.settings.extensionToken}`
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Dashboard sync failed (${response.status})`);
}

async function processBatch(raw: unknown) {
  const batch = scanBatchSchema.parse(raw);
  await updateProviderHealthNotice(batch);
  const state = await getState();
  const previous = new Map(state.listings.map((listing) => [listingStorageKey(listing), listing]));
  const reconciled = reconcileLocalListings(state.listings, batch);
  const scans = [{ batch, receivedAt: new Date().toISOString() }, ...state.scans].slice(0, 30);

  await chrome.storage.local.set({
    [KEYS.listings]: reconciled.sort((a, b) => dealScore(b) - dealScore(a)).slice(0, 15000),
    [KEYS.scans]: scans
  });
  await fireLocalAlerts(state.alerts, batch.listings, previous);

  try {
    await uploadScan(batch, state);
    await updateStatus({
      source: batch.source,
      state: batch.status === "blocked" ? "blocked" : "complete",
      message: batch.status === "blocked"
        ? batch.statusMessage ?? "Marketplace blocked the scan"
        : `${batch.listings.length} listings captured${state.settings.contributionEnabled ? " and synced" : ""}`,
      progress: 100
    });
  } catch (error) {
    await updateStatus({
      source: batch.source,
      state: "error",
      message: error instanceof Error ? error.message : "Upload failed",
      progress: 100
    });
  }
}

async function activeMarketplaceTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function fetchAutoScanJobs(state: ExtensionState): Promise<AutoScanJob[]> {
  if (!state.settings.extensionToken) return [];
  const horizon = Math.min(45, Math.max(1, state.settings.autoScanHorizonDays));
  const response = await fetch(
    `${state.settings.apiBaseUrl.replace(/\/$/, "")}/api/v1/extension/jobs?horizonDays=${horizon}`,
    {
      headers: {
        Authorization: `Bearer ${state.settings.extensionToken}`,
        "X-Extension-Id": chrome.runtime.id
      }
    }
  );
  if (!response.ok) throw new Error(`Could not load automatic scan queue (${response.status})`);
  const payload = (await response.json()) as { jobs?: AutoScanJob[] };
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

function waitForTabComplete(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Marketplace page load timed out"));
    }, TAB_LOAD_TIMEOUT_MS);
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }).catch(() => undefined);
  });
}

async function sendMessageWithTimeout(
  tabId: number,
  message: unknown,
  timeoutMs = TAB_SCAN_TIMEOUT_MS
) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Marketplace scan timed out")), timeoutMs)
    )
  ]);
}

async function scanAutomaticJob(job: AutoScanJob) {
  let tabId: number | undefined;
  try {
    await updateStatus({
      source: job.source,
      state: "scanning",
      message: `Checking ${job.source} for ${job.opponent} deals`,
      progress: 1
    });
    const tab = await chrome.tabs.create({ active: false, url: job.url });
    tabId = tab.id;
    if (!tabId) throw new Error("Chrome could not create a scan tab");
    await waitForTabComplete(tabId);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const result = await sendMessageWithTimeout(
      tabId,
      { type: "START_FULL_SCAN" },
      job.source === "TickPick" ? 90_000 : TAB_SCAN_TIMEOUT_MS
    ) as {
      ok?: boolean;
      error?: string;
    };
    if (!result?.ok) throw new Error(result?.error ?? "Marketplace scan failed");
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function runAutomaticScanCycle() {
  if (automaticScanInProgress) return;
  automaticScanInProgress = true;
  try {
    const state = await getState();
    if (
      !state.settings.autoScanEnabled ||
      !state.settings.contributionEnabled ||
      !state.settings.extensionToken
    ) return;

    const [jobs, stored] = await Promise.all([
      fetchAutoScanJobs(state),
      chrome.storage.local.get(KEYS.autoScanLastRun)
    ]);
    const lastRun =
      (stored[KEYS.autoScanLastRun] as Record<string, number> | undefined) ?? {};
    const selected = selectAutoScanJobs(jobs, lastRun, Date.now(), AUTO_SCAN_JOB_LIMIT);

    if (!selected.length) {
      await reportStalePriorityCoverage(jobs);
      await updateStatus({
        source: null,
        state: "complete",
        message: jobs.length
          ? "Automatic monitoring active; all scheduled checks are current"
          : "Automatic monitoring is connected, but no marketplace event links are available",
        progress: 100
      });
      return;
    }

    for (const job of selected) {
      try {
        await scanAutomaticJob(job);
      } catch (error) {
        await updateStatus({
          source: job.source,
          state: "error",
          message: error instanceof Error ? error.message : "Automatic scan failed",
          progress: 100
        });
      } finally {
        lastRun[autoScanJobKey(job)] = Date.now();
        await chrome.storage.local.set({ [KEYS.autoScanLastRun]: lastRun });
      }
    }
    await reportStalePriorityCoverage(jobs);
  } finally {
    automaticScanInProgress = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCAN_BATCH") {
    processBatch(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "SCAN_PROGRESS") {
    updateStatus(message.payload)
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "GET_STATE") {
    getState().then(sendResponse);
    return true;
  }
  if (message.type === "START_SCAN") {
    activeMarketplaceTab().then(async (tab) => {
      if (!tab?.id) throw new Error("Open a supported marketplace event page");
      await updateStatus({ source: null, state: "scanning", message: "Starting full scan", progress: 1 });
      return chrome.tabs.sendMessage(tab.id, { type: "START_FULL_SCAN" });
    }).then(sendResponse).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "SAVE_SETTINGS") {
    const next = { ...DEFAULT_SETTINGS, ...message.payload };
    chrome.storage.local.set({ [KEYS.settings]: next })
      .then(async () => {
        sendResponse({ ok: true });
        if (next.autoScanEnabled && next.contributionEnabled && next.extensionToken) {
          void runAutomaticScanCycle();
        }
      });
    return true;
  }
  if (message.type === "SAVE_ALERT") {
    getState().then(async (state) => {
      const alert = alertRuleSchema.parse(message.payload);
      const alerts = [...state.alerts.filter((item) => item.id !== alert.id), alert];
      await chrome.storage.local.set({ [KEYS.alerts]: alerts });
      await syncPrivateResource(state, "/api/v1/alerts", "POST", alert);
      sendResponse({ ok: true, alerts });
    }).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "DELETE_ALERT") {
    getState().then(async (state) => {
      const alerts = state.alerts.filter((item) => item.id !== message.payload.id);
      await chrome.storage.local.set({ [KEYS.alerts]: alerts });
      await syncPrivateResource(state, `/api/v1/alerts?id=${encodeURIComponent(message.payload.id)}`, "DELETE");
      sendResponse({ ok: true, alerts });
    }).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "TOGGLE_WATCH") {
    getState().then(async (state) => {
      const key = String(message.payload.key);
      const watchlist = state.watchlist.includes(key)
        ? state.watchlist.filter((item) => item !== key)
        : [...state.watchlist, key];
      await chrome.storage.local.set({ [KEYS.watchlist]: watchlist });
      const listing = state.listings.find((item) => listingStorageKey(item) === key);
      if (listing) {
        await syncPrivateResource(state, "/api/v1/watchlist", "POST", {
          source: listing.source,
          listingId: listing.listingId,
          watched: watchlist.includes(key)
        });
      }
      sendResponse({ ok: true, watchlist });
    }).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "CLAIM_EXTENSION") {
    getState().then(async (state) => {
      const response = await fetch(`${state.settings.apiBaseUrl.replace(/\/$/, "")}/api/v1/extension/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: message.payload.code, extensionId: chrome.runtime.id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Connection failed");
      const settings = { ...state.settings, extensionToken: result.token };
      await chrome.storage.local.set({ [KEYS.settings]: settings });
      sendResponse({ ok: true });
      if (settings.autoScanEnabled && settings.contributionEnabled) {
        void runAutomaticScanCycle();
      }
    }).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "DISCONNECT_EXTENSION") {
    getState().then(async (state) => {
      if (state.settings.extensionToken) {
        const response = await fetch(
          `${state.settings.apiBaseUrl.replace(/\/$/, "")}/api/v1/extension/revoke`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${state.settings.extensionToken}` }
          }
        );
        if (!response.ok && response.status !== 401) {
          throw new Error(`Could not revoke extension token (${response.status})`);
        }
      }
      await chrome.storage.local.set({
        [KEYS.settings]: {
          ...state.settings,
          extensionToken: null,
          contributionEnabled: false,
          consentAcceptedAt: null
        }
      });
      sendResponse({ ok: true });
    }).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const stored = await chrome.storage.local.get(KEYS.notificationLinks);
  const links =
    (stored[KEYS.notificationLinks] as Record<string, string> | undefined) ?? {};
  const link = links[notificationId];
  if (!link) return;
  await chrome.tabs.create({ url: link });
  delete links[notificationId];
  await chrome.storage.local.set({ [KEYS.notificationLinks]: links });
  await chrome.notifications.clear(notificationId);
});

chrome.alarms.create(AUTO_SCAN_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_SCAN_ALARM) await runAutomaticScanCycle();
});

chrome.runtime.onStartup.addListener(() => {
  void runAutomaticScanCycle();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(AUTO_SCAN_ALARM, { periodInMinutes: 1 });
  void runAutomaticScanCycle();
});
