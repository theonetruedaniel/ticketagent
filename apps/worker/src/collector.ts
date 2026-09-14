import {
  isBravesHomeEvent,
  parseMarketplaceCard,
  scanBatchSchema,
  type ActiveBrowserPurchaseQuantity,
  type AdapterContext,
  type NormalizedListing
} from "@ticket-agent/contracts";
import type { Page } from "playwright";
import type {
  CandidateCard,
  PageSnapshot,
  ScanJob,
  ScanResult,
  WorkerConfig
} from "./types";
import { extractEmbeddedListingCandidates } from "./embedded-listings";
import {
  quantityPassesForSource,
  resetMarketplaceScroll,
  selectMarketplaceQuantity
} from "./quantity-controls";

export const WORKER_VERSION = "crawlee-0.3.1";

export function detectBlocker(text: string): string | null {
  const normalized = text.slice(0, 12_000).toLowerCase();
  if (
    /captcha|verify you are human|checking your browser|human verification|just a moment|enable javascript and cookies to continue/.test(normalized)
  ) {
    return "Bot or CAPTCHA challenge detected";
  }
  if (
    /access denied|access to this page has been denied|temporarily blocked|unusual traffic|request blocked|request unsuccessful|forbidden|error\s*403|incapsula|pardon our interruption/.test(normalized)
  ) {
    return "Marketplace access is blocked";
  }
  if (/sign in to view|log in to view|sign in to continue/.test(normalized)) {
    return "Marketplace login is required";
  }
  return null;
}

function listingsFromSnapshot(
  snapshot: PageSnapshot,
  job: ScanJob,
  scanId: string,
  requestedQuantity?: ActiveBrowserPurchaseQuantity
): NormalizedListing[] {
  const observedAt = new Date().toISOString();
  const context: AdapterContext = {
    source: job.source,
    sourceEventId: job.sourceEventId,
    eventName: snapshot.eventName,
    eventDate: snapshot.eventDate ?? job.startsAt,
    venue: snapshot.venue ?? "Truist Park",
    pageUrl: job.url,
    observedAt,
    scanId,
    scanCompleteness: "full",
    requestedQuantity
  };
  const deduped = new Map<string, NormalizedListing>();
  for (const candidate of snapshot.candidates) {
    const listing = parseMarketplaceCard(
      job.source,
      candidate.text,
      context,
      candidate.deepLink,
      candidate.nativeId
    );
    if (listing) {
      deduped.set(listing.listingId, {
        ...listing,
        mlbGamePk: job.mlbGamePk
      });
    }
  }
  return [...deduped.values()];
}

export function mergeListings(
  existing: Map<string, NormalizedListing>,
  incoming: NormalizedListing[]
) {
  for (const listing of incoming) {
    existing.set(`${listing.source}:${listing.listingId}`, listing);
  }
  return existing.size;
}

async function snapshot(
  page: Page,
  source: ScanJob["source"],
  requestedQuantity?: ActiveBrowserPurchaseQuantity
): Promise<PageSnapshot> {
  return page.evaluate(({ marketplace, requestedQuantity }): PageSnapshot => {
    const selectors: Record<typeof marketplace, string[]> = {
      SeatGeek: [
        'button[aria-label*="Section"][aria-label*="$"]',
        '[role="region"][aria-label="Listings"] button'
      ],
      TickPick: [
        'button:has([class*="section"])',
        "main button",
        "button"
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
    const bodyText = document.body?.innerText ?? "";
    const embeddedPayloads: unknown[] = [];
    if (marketplace === "TickPick") {
      let embeddedBytes = 0;
      const scripts = document.querySelectorAll<HTMLScriptElement>(
        'script#__NEXT_DATA__, script[type="application/json"], script[type="application/ld+json"]'
      );
      for (const script of [...scripts].slice(0, 20)) {
        const value = script.textContent?.trim();
        if (!value || value.length > 750_000 || embeddedBytes + value.length > 2_000_000) {
          continue;
        }
        try {
          embeddedPayloads.push(JSON.parse(value));
          embeddedBytes += value.length;
        } catch {
          // Ignore non-JSON script payloads.
        }
      }
    }
    const seen = new Set<Element>();
    for (const selector of selectors[marketplace]) {
      try {
        document.querySelectorAll(selector).forEach((element) => seen.add(element));
      } catch {
        // Ignore selectors unsupported by the active browser build.
      }
    }
    let quantityContext: string | null = null;
    if (marketplace === "GameTime") {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((element) =>
          /^\s*\d+\s+tickets?\s*$/i.test(
            element.getAttribute("aria-label") || element.textContent || ""
          )
        );
      quantityContext = button?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    }
    const candidateElements = [...seen]
      .filter((element) => {
        if (marketplace !== "TickPick") return true;
        const text = [
          element.getAttribute("aria-label"),
          element.textContent
        ].filter(Boolean).join(" ");
        return /\bsection\b/i.test(text) && /\$\s*\d/i.test(text);
      })
      .slice(0, 5000);
    const candidates: CandidateCard[] = candidateElements.map((element) => {
      const parts = [
        element.getAttribute("aria-label"),
        element.textContent
      ].filter((value): value is string => Boolean(value));
      if (
        marketplace === "GameTime" &&
        !parts.some((part) => /\d+\s+tickets?/i.test(part)) &&
        quantityContext &&
        requestedQuantity == null
      ) {
        parts.push(quantityContext);
      }
      const anchor = element.closest("a[href]") ?? element.querySelector("a[href]");
      let deepLink = window.location.href;
      const href = anchor?.getAttribute("href");
      if (href) {
        try {
          deepLink = new URL(href, window.location.href).href;
        } catch {
          // Keep the page URL.
        }
      }
      const nativeId =
        element.getAttribute("data-listing-id") ??
        element.getAttribute("data-testid") ??
        element.closest("[data-listing-id]")?.getAttribute("data-listing-id") ??
        deepLink.match(/\/listings?\/([A-Za-z0-9-]+)/)?.[1] ??
        null;
      return {
        text: parts.join(" "),
        deepLink,
        nativeId
      };
    });
    const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
    const titleName = document.title.split("|")[0]?.replace(/tickets?/gi, "").trim();
    const metadata = [
      document.querySelector("time[datetime]")?.getAttribute("datetime"),
      document.querySelector('meta[itemprop="startDate"]')?.getAttribute("content"),
      document.querySelector('meta[property="event:start_time"]')?.getAttribute("content"),
      document.querySelector('meta[property="og:start_time"]')?.getAttribute("content")
    ];
    let eventDate: string | null = null;
    for (const value of metadata) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        eventDate = parsed.toISOString();
        break;
      }
    }
    return {
      title: document.title,
      eventName: h1 || titleName || "Atlanta Braves home game",
      eventDate,
      venue: bodyText.includes("Truist Park") ? "Truist Park" : null,
      bodyText: bodyText.slice(0, 20_000),
      candidates,
      embeddedPayloads,
      explicitEmptyInventory:
        /(?:no|zero)\s+(?:tickets|listings)\s+(?:available|found)|sold\s+out|inventory\s+unavailable/i.test(bodyText)
    };
  }, { marketplace: source, requestedQuantity });
}

async function advance(page: Page) {
  return page.evaluate(() => {
    const progress = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) =>
        !button.disabled &&
        button.offsetParent !== null &&
        /^(load|show|view)\s+more\b|^next(?:\s+page)?$/i.test(
          (button.getAttribute("aria-label") || button.textContent || "").trim()
        )
      );
    const candidates = [
      ...document.querySelectorAll<HTMLElement>("main, [role='region'], [role='list'], div")
    ];
    const container = candidates
      .filter((element) => element.scrollHeight > element.clientHeight + 400)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? document.documentElement;
    const atEnd = container === document.documentElement
      ? window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24
      : container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
    if (atEnd && progress) {
      progress.click();
      return { atEnd: false, clicked: true };
    }
    if (container === document.documentElement) {
      window.scrollTo({
        top: Math.min(
          document.documentElement.scrollHeight,
          window.scrollY + Math.max(360, window.innerHeight * 0.82)
        ),
        behavior: "instant"
      });
    } else {
      container.scrollTo({
        top: Math.min(
          container.scrollHeight,
          container.scrollTop + Math.max(320, container.clientHeight * 0.82)
        ),
        behavior: "instant"
      });
    }
    return { atEnd, clicked: false };
  });
}

export async function prepareMarketplacePage(
  _page: Page,
  _source: ScanJob["source"]
) {
  // Quantity-sensitive sources are prepared inside scanPage so network payloads
  // and rendered cards are scoped to the active one- or two-ticket pass.
}

export async function scanPage(
  page: Page,
  job: ScanJob,
  config: WorkerConfig,
  capturedResponses: () => number,
  capturedCandidates: () => CandidateCard[] = () => [],
  clearCapturedCandidates: () => void = () => undefined
): Promise<ScanResult> {
  const scanId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const accumulated = new Map<string, NormalizedListing>();
  let completed = true;
  let latest = await snapshot(page, job.source);
  let passes = 0;
  let blocker: string | null = null;
  const incompleteReasons: string[] = [];

  const initialBlocker = detectBlocker(`${latest.title}\n${latest.bodyText}`);
  if (!initialBlocker && !isBravesHomeEvent(latest.eventName, latest.venue ?? "Truist Park")) {
    const batch = scanBatchSchema.parse({
      scanId,
      source: job.source,
      sourceEventId: job.sourceEventId,
      completeness: "partial",
      startedAt,
      completedAt: new Date().toISOString(),
      pageUrl: page.url() || job.url,
      extensionVersion: WORKER_VERSION,
      status: "error",
      statusMessage: "Marketplace page was not recognized as a Braves home game",
      listings: []
    });
    return {
      batch,
      diagnostic: {
        pageTitle: latest.title,
        passes,
        capturedResponses: capturedResponses()
      }
    };
  }

  const configuredQuantities = quantityPassesForSource(job.source);
  const quantityPasses: Array<ActiveBrowserPurchaseQuantity | undefined> =
    configuredQuantities.length ? [...configuredQuantities] : [undefined];

  for (const requestedQuantity of quantityPasses) {
    clearCapturedCandidates();
    if (
      requestedQuantity != null &&
      !(await selectMarketplaceQuantity(page, job.source, requestedQuantity))
    ) {
      completed = false;
      incompleteReasons.push(`Could not select ${requestedQuantity} ticket${requestedQuantity === 1 ? "" : "s"}`);
      continue;
    }
    await resetMarketplaceScroll(page);

    let previousSize = accumulated.size;
    let stablePasses = 0;
    let quantityCompleted = false;
    for (let pass = 0; pass < config.maxScanPasses; pass += 1) {
      passes += 1;
      latest = await snapshot(page, job.source, requestedQuantity);
      blocker = detectBlocker(`${latest.title}\n${latest.bodyText}`);
      if (blocker) break;
      const jsonCandidates = [
        ...capturedCandidates(),
        ...latest.embeddedPayloads.flatMap((payload) =>
          extractEmbeddedListingCandidates(payload, page.url() || job.url)
        )
      ];
      const size = mergeListings(
        accumulated,
        listingsFromSnapshot({
          ...latest,
          candidates: [...latest.candidates, ...jsonCandidates]
        }, job, scanId, requestedQuantity)
      );
      stablePasses = size === previousSize ? stablePasses + 1 : 0;
      previousSize = size;
      const progress = await advance(page);
      if (
        progress.atEnd &&
        stablePasses >= 3 &&
        (size > 0 || latest.explicitEmptyInventory)
      ) {
        quantityCompleted = true;
        break;
      }
      await page.waitForTimeout(progress.clicked ? 900 : config.scanDelayMs);
    }
    if (blocker) break;
    if (!quantityCompleted) {
      completed = false;
      incompleteReasons.push(
        requestedQuantity == null
          ? "Marketplace list did not reach a stable end"
          : `${requestedQuantity}-ticket list did not reach a stable end`
      );
    }
  }

  blocker ??= detectBlocker(`${latest.title}\n${latest.bodyText}`);
  const listings = blocker ? [] : [...accumulated.values()];
  const completeness = completed ? "full" : "partial";
  const status = blocker ? "blocked" : completed ? "complete" : "partial";
  const batch = scanBatchSchema.parse({
    scanId,
    source: job.source,
    sourceEventId: job.sourceEventId,
    completeness,
    startedAt,
    completedAt: new Date().toISOString(),
    pageUrl: page.url() || job.url,
    extensionVersion: WORKER_VERSION,
    status,
    statusMessage:
      blocker ??
      (completed
        ? null
        : incompleteReasons.join("; ") || "Worker stopped before the marketplace list reached a stable end"),
    listings
  });
  return {
    batch,
    diagnostic: {
      pageTitle: latest.title,
      passes,
      capturedResponses: capturedResponses()
    }
  };
}
