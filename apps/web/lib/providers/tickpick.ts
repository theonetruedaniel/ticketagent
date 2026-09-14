type JsonObject = Record<string, unknown>;

export type TickPickEventMapping = {
  sourceEventId: string;
  url: string;
  startsOn: string;
  eventName: string;
};

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function collectSportsEvents(value: unknown, output: JsonObject[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectSportsEvents(item, output);
    return;
  }
  const item = record(value);
  if (!item) return;
  if (item["@type"] === "SportsEvent") output.push(item);
  for (const nested of Object.values(item)) collectSportsEvents(nested, output);
}

export function parseTickPickEventMappings(html: string): TickPickEventMapping[] {
  const events: JsonObject[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const payload = match[1];
    if (!payload) continue;
    try {
      collectSportsEvents(JSON.parse(payload), events);
    } catch {
      // Ignore unrelated malformed structured-data blocks.
    }
  }

  const mappings = new Map<string, TickPickEventMapping>();
  for (const event of events) {
    const location = record(event.location);
    const name = typeof event.name === "string" ? event.name.trim() : "";
    const url = typeof event.url === "string" ? event.url.trim() : "";
    const startDate =
      typeof event.startDate === "string" ? event.startDate.trim() : "";
    const sourceEventId = url.match(/\/(\d{6,})\/?$/)?.[1];
    if (
      location?.name !== "Truist Park" ||
      !/Atlanta Braves/i.test(name) ||
      !sourceEventId ||
      !/^https:\/\/www\.tickpick\.com\//i.test(url) ||
      !/^\d{4}-\d{2}-\d{2}/.test(startDate)
    ) {
      continue;
    }
    mappings.set(sourceEventId, {
      sourceEventId,
      url,
      startsOn: startDate.slice(0, 10),
      eventName: name
    });
  }
  return [...mappings.values()];
}
