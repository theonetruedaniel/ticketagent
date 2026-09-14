import { PlaywrightCrawler, log } from "crawlee";
import { scanBatchSchema } from "@ticket-agent/contracts";
import type { Response } from "playwright";
import { loadJobs, uploadBatch } from "./client";
import {
  prepareMarketplacePage,
  scanPage,
  WORKER_VERSION
} from "./collector";
import {
  describeEmbeddedPayload,
  extractEmbeddedListingCandidates
} from "./embedded-listings";
import type { CandidateCard, ScanJob, WorkerConfig } from "./types";

export async function runWorker(config: WorkerConfig) {
  const jobs = await loadJobs(config);
  if (!jobs.length) {
    log.info("No marketplace scan jobs are available");
    return { jobs: 0, succeeded: 0, failed: 0, listings: 0 };
  }

  const capturedCounts = new Map<string, number>();
  const capturedCandidates = new Map<string, Map<string, CandidateCard>>();
  let succeeded = 0;
  let failed = 0;
  let listings = 0;

  const crawler = new PlaywrightCrawler({
    maxConcurrency: config.maxConcurrency,
    // A scheduled cycle will revisit failed jobs. Avoid immediately repeating a
    // blocked marketplace navigation and doubling load on the same source.
    maxRequestRetries: 0,
    navigationTimeoutSecs: config.navigationTimeoutSeconds,
    requestHandlerTimeoutSecs:
      config.navigationTimeoutSeconds +
      Math.ceil(config.maxScanPasses * Math.max(config.scanDelayMs, 900) / 1000) +
      30,
    useSessionPool: true,
    persistCookiesPerSession: true,
    retryOnBlocked: false,
    launchContext: {
      launchOptions: {
        // Operators can opt into the locally installed stable Chrome. The
        // bundled browser remains the portable default.
        channel:
          process.env.TICKET_AGENT_WORKER_BROWSER_CHANNEL?.trim() || undefined,
        headless: config.headless
      }
    },
    preNavigationHooks: [
      async ({ page, request }, gotoOptions) => {
        // Ticket marketplaces often keep analytics/network activity alive long
        // after the useful application shell has rendered.
        gotoOptions.waitUntil = "domcontentloaded";
        capturedCounts.set(request.uniqueKey, 0);
        capturedCandidates.set(request.uniqueKey, new Map());
        const job = request.userData.job as ScanJob;
        page.on("response", (response: Response) => {
          const contentType = response.headers()["content-type"] ?? "";
          const isJson = /application\/json/i.test(contentType);
          if (
            isJson &&
            /listing|inventory|ticket|offer|event/i.test(response.url())
          ) {
            capturedCounts.set(
              request.uniqueKey,
              (capturedCounts.get(request.uniqueKey) ?? 0) + 1
            );
          }
          if (isJson && job.source === "TickPick") {
            void response.json()
              .then((payload) => {
                if (process.env.TICKET_AGENT_WORKER_DEBUG_JSON === "true") {
                  log.info("TickPick JSON response shape", {
                    url: response.url(),
                    fields: describeEmbeddedPayload(payload)
                  });
                }
                const store = capturedCandidates.get(request.uniqueKey);
                if (!store) return;
                for (const candidate of extractEmbeddedListingCandidates(
                  payload,
                  job.url
                )) {
                  store.set(
                    candidate.nativeId ?? `${candidate.text}|${candidate.deepLink}`,
                    candidate
                  );
                }
              })
              .catch(() => {
                // Some JSON-labelled responses are empty or stream-only.
              });
          }
        });
      }
    ],
    async requestHandler({ page, request }) {
      const job = request.userData.job as ScanJob;
      await page.waitForTimeout(1500);
      await prepareMarketplacePage(page, job.source);
      const result = await scanPage(
        page,
        job,
        config,
        () => capturedCounts.get(request.uniqueKey) ?? 0,
        () => [...(capturedCandidates.get(request.uniqueKey)?.values() ?? [])],
        () => capturedCandidates.get(request.uniqueKey)?.clear()
      );
      const upload = await uploadBatch(config, result.batch);
      succeeded += 1;
      listings += result.batch.listings.length;
      log.info("Marketplace scan finished", {
        source: job.source,
        sourceEventId: job.sourceEventId,
        status: result.batch.status,
        completeness: result.batch.completeness,
        listingCount: result.batch.listings.length,
        pageTitle: result.diagnostic.pageTitle,
        capturedResponses: result.diagnostic.capturedResponses,
        dryRun: config.dryRun,
        upload
      });
    },
    async failedRequestHandler({ request }, error) {
      failed += 1;
      const job = request.userData.job as ScanJob;
      const now = new Date().toISOString();
      const blocked = /403|blocked|captcha|access denied/i.test(error.message);
      try {
        await uploadBatch(config, scanBatchSchema.parse({
          scanId: crypto.randomUUID(),
          source: job.source,
          sourceEventId: job.sourceEventId,
          completeness: "partial",
          startedAt: now,
          completedAt: now,
          pageUrl: job.url,
          extensionVersion: WORKER_VERSION,
          status: blocked ? "blocked" : "error",
          statusMessage: error.message.slice(0, 500),
          listings: []
        }));
      } catch (reportError) {
        log.error("Marketplace failure report could not be uploaded", {
          source: job.source,
          sourceEventId: job.sourceEventId,
          error: reportError instanceof Error ? reportError.message : String(reportError)
        });
      }
      log.error("Marketplace scan failed", {
        source: job.source,
        sourceEventId: job.sourceEventId,
        error: error.message
      });
    }
  });

  // Crawlee persists its request queue between scheduled cycles. Include a
  // cycle identifier so recurring marketplace jobs are processed again while
  // still deduplicating duplicate jobs inside this one run.
  const cycleId = crypto.randomUUID();
  await crawler.run(
    jobs.map((job) => ({
      url: job.url,
      uniqueKey: `${cycleId}:${job.source}:${job.sourceEventId}`,
      userData: { job }
    }))
  );

  return { jobs: jobs.length, succeeded, failed, listings };
}
