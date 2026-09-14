import {
  type AdapterContext,
  type ActiveBrowserPurchaseQuantity,
  type MarketplaceSource,
  type NormalizedListing,
  type ProviderEvidenceCandidate,
  isBravesHomeEvent,
  listingCanFulfillQuantity,
  parseMarketplaceCard,
  scanBatchSchema,
  stableListingId
} from "@ticket-agent/contracts";
import { ScanAccumulator } from "./scan-session";
import {
  detectBlocker,
  hasExplicitEmptyInventory,
  isProgressControlLabel,
  isSuspiciousEmptyAccessPage
} from "./page-signals";
import {
  quantityPassesForSource,
  resetMarketplaceScroll,
  selectMarketplaceQuantity
} from "./quantity-controls";

const VERSION = "0.2.1";
let scanInProgress = false;
let mutationTimer: number | undefined;
const providerEvidence = new Map<string, ProviderEvidenceCandidate>();

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !event.data ||
    event.data.source !== "ticket-agent-provider-evidence" ||
    !Array.isArray(event.data.candidates)
  ) return;
  const currentSource = sourceForHost(window.location.hostname);
  if (currentSource !== "SeatGeek" && currentSource !== "StubHub") return;
  for (const candidate of event.data.candidates.slice(0, 1000)) {
    if (
      !candidate ||
      candidate.source !== currentSource ||
      typeof candidate.nativeId !== "string" ||
      typeof candidate.section !== "string" ||
      !Number.isFinite(candidate.pricePerTicket) ||
      !Number.isInteger(candidate.quantityMin) ||
      !Number.isInteger(candidate.quantityMax) ||
      candidate.quantityMin < 1 ||
      candidate.quantityMax < candidate.quantityMin ||
      candidate.currency !== "USD"
    ) continue;
    providerEvidence.set(
      `${candidate.source}:${candidate.nativeId}:${candidate.quantityMin}:${candidate.quantityMax}`,
      candidate
    );
  }
});

function sourceForHost(hostname: string): MarketplaceSource | null {
  if (hostname.includes("seatgeek.com")) return "SeatGeek";
  if (hostname.includes("stubhub.com")) return "StubHub";
  if (hostname.includes("tickpick.com")) return "TickPick";
  if (hostname.includes("gametime.co")) return "GameTime";
  return null;
}

function sourceEventId(source: MarketplaceSource): string {
  const url = new URL(window.location.href);
  const patterns: Record<MarketplaceSource, RegExp[]> = {
    SeatGeek: [/\/mlb\/(\d+)/, /\/(\d{7,})(?:[/?#]|$)/],
    StubHub: [/\/event\/(\d+)/, /\/category\/(\d+)/],
    TickPick: [/\/(\d{6,})(?:[/?#]|$)/],
    GameTime: [/\/events\/([a-f0-9]{12,})/i]
  };
  for (const pattern of patterns[source]) {
    const match = url.pathname.match(pattern);
    if (match?.[1]) return match[1];
  }
  return `${source.toLowerCase()}-${url.pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(-100)}`;
}

function eventName(): string {
  const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
  const title = document.title.split("|")[0]?.replace(/tickets?/gi, "").trim();
  return h1 || title || "Atlanta Braves home game";
}

function eventDate(): string | null {
  const metadataCandidates = [
    document.querySelector("time[datetime]")?.getAttribute("datetime"),
    document.querySelector('meta[itemprop="startDate"]')?.getAttribute("content"),
    document.querySelector('meta[property="event:start_time"]')?.getAttribute("content"),
    document.querySelector('meta[property="og:start_time"]')?.getAttribute("content")
  ];
  for (const candidate of metadataCandidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  function findStartDate(value: unknown): string | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findStartDate(item);
        if (found) return found;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.startDate === "string") return record.startDate;
    for (const nested of Object.values(record)) {
      const found = findStartDate(nested);
      if (found) return found;
    }
    return null;
  }

  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]'
  )) {
    try {
      const startDate = findStartDate(JSON.parse(script.textContent ?? ""));
      if (!startDate) continue;
      const parsed = new Date(startDate);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  }
  return null;
}

function pageVenue(): string | null {
  return document.body?.innerText.includes("Truist Park") ? "Truist Park" : null;
}

function isCurrentBravesHomeEvent() {
  return isBravesHomeEvent(eventName(), pageVenue());
}

function isBlocked(): string | null {
  const bodyText = document.body?.innerText ?? "";
  const detected = detectBlocker(`${document.title}\n${bodyText}`);
  if (detected) return detected;
  const source = sourceForHost(window.location.hostname);
  if (
    source &&
    isSuspiciousEmptyAccessPage(
      document.title,
      bodyText,
      candidateElements(source).length
    )
  ) {
    return "Marketplace returned an empty access-block page";
  }
  return null;
}

function candidateElements(source: MarketplaceSource): Element[] {
  const selectors: Record<MarketplaceSource, string[]> = {
    SeatGeek: [
      'button[aria-label*="Section"][aria-label*="$"]',
      '[role="region"][aria-label="Listings"] button'
    ],
    TickPick: [
      '[role="button"][aria-label^="Buy tickets for Section"]',
      'button:has([class*="section"])'
    ],
    GameTime: [
      'a[href*="/listings/"]'
    ],
    StubHub: [
      '[data-testid*="listing"]',
      'a[href*="/event/"][href*="listing"]',
      '[role="listitem"]',
      "main button"
    ]
  };

  const seen = new Set<Element>();
  for (const selector of selectors[source]) {
    try {
      document.querySelectorAll(selector).forEach((element) => seen.add(element));
    } catch {
      // A marketplace can ship CSS unsupported by an older Chrome build.
    }
  }
  return [...seen].slice(0, 5000);
}

async function waitForTickPickInventory() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const bodyText = document.body?.innerText ?? "";
    if (
      candidateElements("TickPick").length > 0 ||
      hasExplicitEmptyInventory(bodyText)
    ) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return false;
}

function displayedQuantityContext(source: MarketplaceSource): string | null {
  if (source !== "GameTime") return null;
  const quantityButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) =>
      /^\s*\d+\s+tickets?\s*$/i.test(
        button.getAttribute("aria-label") || button.textContent || ""
      )
    );
  return quantityButton?.textContent?.replace(/\s+/g, " ").trim() ?? null;
}

function deepLinkFor(element: Element): string {
  const anchor = element.closest("a[href]") ?? element.querySelector("a[href]");
  const href = anchor?.getAttribute("href");
  if (!href) return window.location.href;
  try {
    return new URL(href, window.location.href).href;
  } catch {
    return window.location.href;
  }
}

function nativeIdFor(element: Element, deepLink: string): string | null {
  const explicit = element.getAttribute("data-listing-id")
    ?? element.getAttribute("data-testid")
    ?? element.closest("[data-listing-id]")?.getAttribute("data-listing-id");
  if (explicit) return explicit;
  return deepLink.match(/\/listings?\/([A-Za-z0-9-]+)/)?.[1] ?? null;
}

function collectListings(
  source: MarketplaceSource,
  scanId: string,
  completeness: "partial" | "full",
  requestedQuantity?: ActiveBrowserPurchaseQuantity
): NormalizedListing[] {
  const observedAt = new Date().toISOString();
  if (source === "SeatGeek" || source === "StubHub") {
    return [...providerEvidence.values()]
      .filter((candidate) =>
        candidate.source === source &&
        (
          requestedQuantity == null ||
          listingCanFulfillQuantity(candidate, requestedQuantity)
        )
      )
      .map((candidate) => {
        const listingId = stableListingId({
          source,
          sourceEventId: sourceEventId(source),
          nativeId: candidate.nativeId,
          section: candidate.section,
          row: candidate.row,
          seatFrom: null,
          seatTo: null,
          quantityMin: candidate.quantityMin,
          quantityMax: candidate.quantityMax,
          pricePerTicket: candidate.pricePerTicket,
          deepLink: candidate.deepLink
        });
        return {
          source,
          sourceEventId: sourceEventId(source),
          listingId,
          mlbGamePk: null,
          observedAt,
          scanId,
          scanCompleteness: completeness,
          eventName: eventName(),
          eventDate: eventDate(),
          venue: pageVenue(),
          section: candidate.section,
          row: candidate.row,
          seatFrom: null,
          seatTo: null,
          quantityMin: candidate.quantityMin,
          quantityMax: candidate.quantityMax,
          pricePerTicket: candidate.pricePerTicket,
          currency: "USD",
          allIn: true,
          collectionMode: "browser_observed" as const,
          priceBasis: "all_in" as const,
          providerObservedAt: candidate.providerObservedAt,
          accessible: candidate.accessible,
          limitedView: candidate.limitedView,
          notes: [],
          deepLink: candidate.deepLink
        };
      });
  }

  const context: AdapterContext = {
    source,
    sourceEventId: sourceEventId(source),
    eventName: eventName(),
    eventDate: eventDate(),
    venue: pageVenue(),
    pageUrl: window.location.href,
    observedAt,
    scanId,
    scanCompleteness: completeness,
    requestedQuantity
  };

  const deduped = new Map<string, NormalizedListing>();
  for (const element of candidateElements(source)) {
    const parts = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean);
    if (
      source === "GameTime" &&
      requestedQuantity == null &&
      !parts.some((part) => /\d+\s+tickets?/i.test(part ?? ""))
    ) {
      parts.push(displayedQuantityContext(source));
    }
    const text = parts.filter(Boolean).join(" ");
    const link = deepLinkFor(element);
    const listing = parseMarketplaceCard(source, text, context, link, nativeIdFor(element, link));
    if (listing) deduped.set(listing.listingId, listing);
  }
  return [...deduped.values()];
}

async function sendScan(
  completeness: "partial" | "full",
  status: "complete" | "partial" | "blocked" | "error",
  statusMessage: string | null,
  session?: {
    scanId: string;
    startedAt: string;
    listings: NormalizedListing[];
  }
) {
  const source = sourceForHost(window.location.hostname);
  if (!source) return;
  const scanId = session?.scanId ?? crypto.randomUUID();
  const startedAt = session?.startedAt ?? new Date().toISOString();
  const listings = status === "blocked" || status === "error"
    ? []
    : (session?.listings ?? collectListings(source, scanId, completeness))
      .map((listing) => ({ ...listing, scanCompleteness: completeness }));
  const batch = scanBatchSchema.parse({
    scanId,
    source,
    sourceEventId: sourceEventId(source),
    completeness,
    startedAt,
    completedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    extensionVersion: VERSION,
    status,
    statusMessage,
    listings
  });
  await chrome.runtime.sendMessage({ type: "SCAN_BATCH", payload: batch });
}

function reportPassiveScanFailure(error: unknown) {
  const source = sourceForHost(window.location.hostname);
  void chrome.runtime.sendMessage({
    type: "SCAN_PROGRESS",
    payload: {
      source,
      state: "error",
      message: error instanceof Error ? error.message : "Page capture failed",
      progress: 0
    }
  }).catch(() => undefined);
}

function findScrollableContainer(): HTMLElement {
  const candidates = [...document.querySelectorAll<HTMLElement>("main, [role='region'], [role='list'], div")];
  return candidates
    .filter((element) => element.scrollHeight > element.clientHeight + 400)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? document.documentElement;
}

function atScrollableEnd(container: HTMLElement) {
  if (container === document.documentElement) {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
  }
  return container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
}

function advanceScroll(container: HTMLElement) {
  if (container === document.documentElement) {
    window.scrollTo({
      top: Math.min(
        document.documentElement.scrollHeight,
        window.scrollY + Math.max(360, window.innerHeight * 0.82)
      ),
      behavior: "smooth"
    });
    return;
  }
  container.scrollTo({
    top: Math.min(
      container.scrollHeight,
      container.scrollTop + Math.max(320, container.clientHeight * 0.82)
    ),
    behavior: "smooth"
  });
}

function clickProgressControl() {
  const control = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) =>
      !button.disabled &&
      button.offsetParent !== null &&
      isProgressControlLabel(button.getAttribute("aria-label") || button.textContent || "")
    );
  control?.click();
  return Boolean(control);
}

async function fullScan() {
  if (scanInProgress) return;
  scanInProgress = true;
  try {
    const source = sourceForHost(window.location.hostname);
    if (!source) return;
    if (!isCurrentBravesHomeEvent()) {
      await chrome.runtime.sendMessage({
        type: "SCAN_PROGRESS",
        payload: {
          source,
          state: "error",
          message: "Open a Braves home game at Truist Park before scanning",
          progress: 0
        }
      });
      return;
    }
    if (source === "TickPick" && !(await waitForTickPickInventory())) {
      const blocker = isBlocked();
      await sendScan(
        "full",
        blocker ? "blocked" : "error",
        blocker ??
          "TickPick listing inventory did not finish loading; no prices were accepted"
      );
      return;
    }
    const blocked = isBlocked();
    if (blocked) {
      await sendScan("full", "blocked", blocked);
      return;
    }

    await chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      payload: { source, state: "scanning", message: "Loading marketplace listings", progress: 5 }
    });

    const scanId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const accumulated = new ScanAccumulator();
    let completed = true;
    const incompleteReasons: string[] = [];
    const configuredQuantities = quantityPassesForSource(source);
    const quantityPasses: Array<ActiveBrowserPurchaseQuantity | undefined> =
      configuredQuantities.length ? [...configuredQuantities] : [undefined];
    let totalPasses = 0;

    for (const requestedQuantity of quantityPasses) {
      if (
        requestedQuantity != null &&
        !(await selectMarketplaceQuantity(source, requestedQuantity))
      ) {
        completed = false;
        incompleteReasons.push(
          `Could not select ${requestedQuantity} ticket${requestedQuantity === 1 ? "" : "s"}`
        );
        continue;
      }
      resetMarketplaceScroll();
      const container = findScrollableContainer();
      const quantityAccumulator = new ScanAccumulator();
      let quantityCompleted = false;

      for (let pass = 0; pass < 48; pass += 1) {
        totalPasses += 1;
        const observed = collectListings(source, scanId, "full", requestedQuantity);
        quantityAccumulator.add(observed);
        const count = accumulated.add(observed);
        await chrome.runtime.sendMessage({
          type: "SCAN_PROGRESS",
          payload: {
            source,
            state: "scanning",
            message: `${count} listing cards loaded${
              requestedQuantity == null ? "" : ` across ${requestedQuantity}-ticket inventory`
            }`,
            progress: Math.min(94, 6 + totalPasses)
          }
        });
        const blocker = isBlocked();
        if (blocker) break;

        const atEnd = atScrollableEnd(container);
        if (atEnd && clickProgressControl()) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          continue;
        }
        if (
          atEnd &&
          quantityAccumulator.stablePasses >= 3 &&
          (
            quantityAccumulator.values().length > 0 ||
            hasExplicitEmptyInventory(document.body?.innerText ?? "")
          )
        ) {
          quantityCompleted = true;
          break;
        }
        advanceScroll(container);
        await new Promise((resolve) => window.setTimeout(resolve, 550));
      }
      if (isBlocked()) break;
      if (!quantityCompleted) {
        completed = false;
        incompleteReasons.push(
          requestedQuantity == null
            ? "Marketplace list did not reach a stable end"
            : `${requestedQuantity}-ticket list did not reach a stable end`
        );
      }
    }

    const finalBlocked = isBlocked();
    const restrictedSource = source === "SeatGeek" || source === "StubHub";
    const explicitEmpty = hasExplicitEmptyInventory(document.body?.innerText ?? "");
    const missingProviderEvidence =
      restrictedSource &&
      providerEvidence.size === 0 &&
      !explicitEmpty;
    const completeness = completed && !missingProviderEvidence ? "full" : "partial";
    await sendScan(
      completeness,
      finalBlocked
        ? "blocked"
        : missingProviderEvidence
          ? "error"
          : completed
            ? "complete"
            : "partial",
      finalBlocked ?? (
        missingProviderEvidence
          ? `${source} did not expose listing-level all-in price evidence; no prices were accepted`
          : completed
            ? null
            : incompleteReasons.join("; ") || "Scan stopped before the marketplace list reached a stable end"
      ),
      { scanId, startedAt, listings: accumulated.values() }
    );
  } finally {
    scanInProgress = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_FULL_SCAN") {
    fullScan().then(() => sendResponse({ ok: true })).catch((error: Error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message.type === "START_PARTIAL_SCAN") {
    if (!isCurrentBravesHomeEvent()) {
      sendResponse({ ok: true, skipped: true });
      return;
    }
    const blocked = isBlocked();
    sendScan("partial", blocked ? "blocked" : "partial", blocked)
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "GET_PAGE_STATUS") {
    sendResponse({
      source: sourceForHost(window.location.hostname),
      eventName: eventName(),
      eventDate: eventDate(),
      blocked: isBlocked(),
      bravesHome: isCurrentBravesHomeEvent()
    });
  }
});

const observer = new MutationObserver(() => {
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(() => {
    const source = sourceForHost(window.location.hostname);
    if (
      source &&
      isCurrentBravesHomeEvent() &&
      !scanInProgress &&
      source !== "SeatGeek" &&
      source !== "StubHub" &&
      !isBlocked() &&
      candidateElements(source).length > 0
    ) {
      void sendScan("partial", "partial", "Passive page update")
        .catch(reportPassiveScanFailure);
    }
  }, 1400);
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
const initialBlocker = isBlocked();
if (isCurrentBravesHomeEvent()) {
  const source = sourceForHost(window.location.hostname);
  if (source !== "SeatGeek" && source !== "StubHub") {
    void sendScan(
      "partial",
      initialBlocker ? "blocked" : "partial",
      initialBlocker ?? "Initial page capture"
    ).catch(reportPassiveScanFailure);
  }
} else {
  void chrome.runtime.sendMessage({
    type: "SCAN_PROGRESS",
    payload: {
      source: sourceForHost(window.location.hostname),
      state: "idle",
      message: "Open a Braves home game at Truist Park",
      progress: 0
    }
  });
}
