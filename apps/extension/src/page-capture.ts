import {
  extractProviderEvidenceCandidates,
  type MarketplaceSource
} from "@ticket-agent/contracts";

const MESSAGE_SOURCE = "ticket-agent-provider-evidence";
const emitted = new Map<string, string>();

function marketplace(): MarketplaceSource | null {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes("seatgeek.com")) return "SeatGeek";
  if (hostname.includes("stubhub.com")) return "StubHub";
  return null;
}

function emit(payload: unknown) {
  const source = marketplace();
  if (!source) return;
  const candidates = extractProviderEvidenceCandidates(
    source,
    payload,
    window.location.href,
    new Date().toISOString(),
    1000
  ).filter((candidate) => {
    const key = `${candidate.source}:${candidate.nativeId}:${candidate.quantityMin}:${candidate.quantityMax}`;
    const signature = JSON.stringify([
      candidate.pricePerTicket,
      candidate.section,
      candidate.row,
      candidate.providerObservedAt
    ]);
    if (emitted.get(key) === signature) return false;
    emitted.set(key, signature);
    return true;
  });
  if (!candidates.length) return;
  window.postMessage({
    source: MESSAGE_SOURCE,
    candidates
  }, window.location.origin);
}

function parseJson(value: string) {
  if (!value || value.length > 5_000_000) return;
  try {
    emit(JSON.parse(value));
  } catch {
    // Ignore non-JSON response bodies and scripts.
  }
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const contentType = response.headers.get("content-type") ?? "";
  if (/json/i.test(contentType)) {
    void response.clone().text().then(parseJson).catch(() => undefined);
  }
  return response;
};

const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null
) {
  this.addEventListener("load", () => {
    try {
      if (this.responseType === "json") {
        emit(this.response);
      } else if (this.responseType === "" || this.responseType === "text") {
        const contentType = this.getResponseHeader("content-type") ?? "";
        if (/json/i.test(contentType)) parseJson(this.responseText);
      }
    } catch {
      // Ignore opaque, binary, or cross-origin responses.
    }
  }, { once: true });
  return originalOpen.call(
    this,
    method,
    url,
    (async as boolean | undefined) ?? true,
    username,
    password
  );
};

function scanInlineJson() {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script#__NEXT_DATA__'
  )) {
    parseJson(script.textContent ?? "");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scanInlineJson, { once: true });
} else {
  scanInlineJson();
}
window.setTimeout(scanInlineJson, 1500);
