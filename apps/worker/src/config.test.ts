import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const ENV_KEYS = [
  "TICKET_AGENT_API_BASE_URL",
  "TICKET_AGENT_EXTENSION_TOKEN",
  "DEV_EXTENSION_TOKEN",
  "TICKET_AGENT_WORKER_URLS",
  "TICKET_AGENT_WORKER_DRY_RUN",
  "TICKET_AGENT_WORKER_MAX_CONCURRENCY"
] as const;

const original = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("worker configuration", () => {
  it("defaults to dry-run mode", () => {
    process.env.TICKET_AGENT_EXTENSION_TOKEN = "test-token";
    delete process.env.TICKET_AGENT_WORKER_DRY_RUN;
    expect(loadConfig().dryRun).toBe(true);
  });

  it("accepts a bounded pilot without an API token", () => {
    delete process.env.TICKET_AGENT_EXTENSION_TOKEN;
    delete process.env.DEV_EXTENSION_TOKEN;
    process.env.TICKET_AGENT_WORKER_URLS = JSON.stringify([{
      source: "GameTime",
      sourceEventId: "event-123",
      url: "https://gametime.co/events/event-123",
      mlbGamePk: "123",
      opponent: "Mets",
      startsAt: "2026-08-01T23:00:00.000Z"
    }]);
    const config = loadConfig();
    expect(config.urls).toHaveLength(1);
    expect(config.urls[0]?.source).toBe("GameTime");
  });

  it("rejects unsafe concurrency values", () => {
    process.env.TICKET_AGENT_EXTENSION_TOKEN = "test-token";
    process.env.TICKET_AGENT_WORKER_MAX_CONCURRENCY = "100";
    expect(() => loadConfig()).toThrow(/MAX_CONCURRENCY/);
  });
});
