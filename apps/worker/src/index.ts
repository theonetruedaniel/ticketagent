import { log } from "crawlee";
import { loadConfig } from "./config";
import { runWorker } from "./runner";

try {
  const config = loadConfig();
  log.info("Starting TicketAgent Crawlee worker", {
    apiBaseUrl: config.apiBaseUrl,
    dryRun: config.dryRun,
    headless: config.headless,
    maxConcurrency: config.maxConcurrency,
    maxJobs: config.maxJobs,
    pilotJobs: config.urls.length
  });
  const result = await runWorker(config);
  log.info("TicketAgent Crawlee worker completed", result);
  // This is a bounded scheduled CLI, not a long-lived Crawlee process.
  // A cycle is operationally successful when at least one marketplace batch
  // was uploaded, even if other marketplaces rejected their navigation.
  process.exit(result.failed > 0 && result.succeeded === 0 ? 1 : 0);
} catch (error) {
  log.error("TicketAgent Crawlee worker stopped", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}
