import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  ChartNoAxesCombined,
  CircleGauge,
  CloudUpload,
  Download,
  ExternalLink,
  History,
  Radar,
  RefreshCw,
  ScanSearch,
  Settings,
  ShieldCheck,
  Star,
  Trash2
} from "lucide-react";
import { dealScore, type AlertRule, type NormalizedListing } from "@ticket-agent/contracts";
import { listingStorageKey } from "./scan-session";
import { DEFAULT_SETTINGS, type ExtensionState } from "./types";
import "./popup.css";

type Tab = "scanner" | "deals" | "alerts" | "watchlist" | "history" | "dashboard";

const EMPTY_STATE: ExtensionState = {
  settings: DEFAULT_SETTINGS,
  listings: [],
  alerts: [],
  watchlist: [],
  scans: [],
  currentStatus: { source: null, state: "idle", message: "Open a supported marketplace", progress: 0 }
};

function send<T>(type: string, payload?: unknown): Promise<T> {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension background is unavailable. Reload the extension."));
  }
  return chrome.runtime.sendMessage({ type, payload });
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function exportCsv(listings: NormalizedListing[]) {
  const columns = [
    "source", "eventName", "eventDate", "section", "row", "seatFrom", "seatTo",
    "quantityMin", "quantityMax", "pricePerTicket", "currency", "allIn",
    "accessible", "limitedView", "notes", "observedAt", "deepLink"
  ];
  const rows = [columns, ...listings.map((listing) => columns.map((key) => String(listing[key as keyof NormalizedListing] ?? "")))];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  anchor.download = `braves-ticket-scan-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function ListingRow({
  listing,
  watched,
  onWatch
}: {
  listing: NormalizedListing;
  watched: boolean;
  onWatch: () => void;
}) {
  const score = dealScore(listing);
  return (
    <article className="listing-card">
      <div className="listing-source">
        <span className={`source-dot ${listing.source.toLowerCase()}`} />
        {listing.source}
        <span className="score">{score}</span>
      </div>
      <div className="listing-main">
        <div>
          <strong>{listing.section}</strong>
          <span>Row {listing.row ?? "TBD"} · {listing.quantityMin === listing.quantityMax ? listing.quantityMin : `${listing.quantityMin}-${listing.quantityMax}`} seats</span>
        </div>
        <b>{money(listing.pricePerTicket, listing.currency)}</b>
      </div>
      <div className="listing-meta">
        <span>{listing.allIn ? "All-in" : "Fees unconfirmed"}</span>
        <span>{new Date(listing.observedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <button type="button" aria-label={watched ? "Remove from watchlist" : "Add to watchlist"} onClick={onWatch}>
          <Star size={14} fill={watched ? "currentColor" : "none"} />
        </button>
        <a href={listing.deepLink} target="_blank" rel="noreferrer" aria-label="Open marketplace listing">
          <ExternalLink size={14} />
        </a>
      </div>
    </article>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("scanner");
  const [state, setState] = useState<ExtensionState>(EMPTY_STATE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [alertType, setAlertType] = useState<AlertRule["type"]>("price");
  const [alertPrice, setAlertPrice] = useState("50");
  const [alertSection, setAlertSection] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const initialized = useRef(false);

  async function refresh() {
    try {
      const next = await send<ExtensionState | undefined>("GET_STATE");
      if (!next?.settings || !Array.isArray(next.listings)) {
        throw new Error("Extension background returned no state. Reload the extension.");
      }
      setState(next);
      if (!initialized.current) {
        initialized.current = true;
        setTab(next.settings.extensionToken ? "scanner" : "dashboard");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load extension state");
    }
  }

  useEffect(() => {
    void refresh();
    if (!globalThis.chrome?.runtime?.onMessage) {
      setMessage("Extension background is unavailable. Reload the extension.");
      return;
    }
    const listener = (event: { type?: string }) => {
      if (event.type === "STATE_UPDATED") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const sorted = useMemo(
    () => [...state.listings].sort((a, b) => dealScore(b) - dealScore(a)),
    [state.listings]
  );
  const watched = sorted.filter((listing) => state.watchlist.includes(listingStorageKey(listing)));
  const best = sorted[0];

  async function scan() {
    setBusy(true);
    setMessage("");
    try {
      const result = await send<{ ok?: boolean; error?: string }>("START_SCAN");
      if (!result?.ok && result?.error) setMessage(result.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the scan");
    } finally {
      window.setTimeout(() => setBusy(false), 800);
    }
  }

  async function toggleWatch(listing: NormalizedListing) {
    await send("TOGGLE_WATCH", { key: listingStorageKey(listing) });
    await refresh();
  }

  async function saveAlert() {
    const parsedPrice = Number(alertPrice);
    if (alertType === "price" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      setMessage("Enter a valid all-in price");
      return;
    }
    const alert: AlertRule = {
      id: crypto.randomUUID(),
      type: alertType,
      enabled: true,
      mlbGamePk: null,
      source: null,
      sectionQuery: alertSection.trim() || null,
      quantity: 1,
      maxPrice: alertType === "price" ? parsedPrice : null,
      accessible: null,
      emailEnabled: true
    };
    await send("SAVE_ALERT", alert);
    setMessage("Price alert saved");
    await refresh();
  }

  async function updateSettings(next: Partial<ExtensionState["settings"]>) {
    try {
      await send("SAVE_SETTINGS", { ...state.settings, ...next });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save extension settings");
    }
  }

  async function claimExtension() {
    if (!claimCode.trim()) {
      setMessage("Enter the one-time code shown on the dashboard");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await send<{ ok: boolean; error?: string }>("CLAIM_EXTENSION", { code: claimCode.trim() });
      if (result.ok) {
        setClaimCode("");
        setMessage("Extension connected");
        setTab("scanner");
      } else {
        setMessage(result.error ?? "Connection failed");
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[Tab, React.ReactNode, string]> = [
    ["scanner", <ScanSearch size={17} />, "Scan"],
    ["deals", <CircleGauge size={17} />, "Deals"],
    ["alerts", <Bell size={17} />, "Alerts"],
    ["watchlist", <Star size={17} />, "Saved"],
    ["history", <History size={17} />, "History"],
    ["dashboard", <ChartNoAxesCombined size={17} />, "Hub"]
  ];

  return (
    <main className="extension-shell">
      <header className="extension-header">
        <div className="brand-mark">A</div>
        <div>
          <span className="eyebrow">PRIVATE SCOUT / ATL</span>
          <h1>Braves Ticket Scanner</h1>
        </div>
        <span className={`live-lamp ${state.currentStatus.state}`} />
      </header>

      <nav className="tab-strip" aria-label="Extension sections">
        {tabs.map(([id, icon, label]) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="tab-body">
        {tab === "scanner" && (
          <section className="scanner-panel">
            <div className="status-band">
              <div>
                <span className="eyebrow">{state.currentStatus.source ?? "SCANNER READY"}</span>
                <strong>{state.currentStatus.message}</strong>
              </div>
              <span>{state.currentStatus.progress}%</span>
            </div>
            <div className="progress-track"><span style={{ width: `${state.currentStatus.progress}%` }} /></div>

            <div className="metric-grid">
              <div><span>Captured</span><b>{state.listings.length}</b></div>
              <div><span>Sources</span><b>{new Set(state.listings.map((item) => item.source)).size}/4</b></div>
              <div><span>Best</span><b>{best ? money(best.pricePerTicket) : "—"}</b></div>
            </div>

            <button className="scan-button" type="button" onClick={scan} disabled={busy}>
              <Radar size={19} className={busy ? "spin" : ""} />
              {busy ? "Starting scan…" : "Run full page scan"}
            </button>
            <div className={`monitor-card ${
              state.settings.extensionToken &&
              state.settings.contributionEnabled &&
              state.settings.autoScanEnabled
                ? "active"
                : ""
            }`}>
              <Radar size={17} />
              <div>
                <strong>{
                  state.settings.extensionToken &&
                  state.settings.contributionEnabled &&
                  state.settings.autoScanEnabled
                    ? "Automatic monitoring is on"
                    : "Automatic monitoring is off"
                }</strong>
                <span>Chrome checks alert games in background tabs every five minutes.</span>
              </div>
            </div>
            <p className="safety-note"><ShieldCheck size={14} /> Reads only rendered listing information. A login wall, bot check, or CAPTCHA stops that source.</p>
            {message && <p className="inline-message" aria-live="polite">{message}</p>}
          </section>
        )}

        {tab === "deals" && (
          <section>
            <div className="section-head">
              <div><span className="eyebrow">VALUE BOARD</span><h2>Best captured deals</h2></div>
              <button type="button" onClick={() => exportCsv(sorted)} aria-label="Export listings to CSV"><Download size={16} /></button>
            </div>
            <div className="listing-stack">
              {sorted.slice(0, 40).map((listing) => (
                <ListingRow key={listingStorageKey(listing)} listing={listing} watched={state.watchlist.includes(listingStorageKey(listing))} onWatch={() => toggleWatch(listing)} />
              ))}
              {!sorted.length && <div className="empty-panel">No captured inventory yet. Automatic monitoring begins after the extension is connected, scan contribution is enabled, and a deal alert is saved.</div>}
            </div>
          </section>
        )}

        {tab === "alerts" && (
          <section>
            <div className="section-head"><div><span className="eyebrow">TRIGGER RULES</span><h2>Price alerts</h2></div><Bell size={18} /></div>
            <div className="form-grid">
              <label>Alert type
                <select value={alertType} onChange={(event) => setAlertType(event.target.value as AlertRule["type"])}>
                  <option value="price">Price at or below</option>
                  <option value="priceDrop">Any price drop</option>
                  <option value="newListing">New matching listing</option>
                </select>
              </label>
              {alertType === "price" && (
                <label>Maximum all-in price<input type="number" min="1" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} /></label>
              )}
              <label>Section contains<input value={alertSection} onChange={(event) => setAlertSection(event.target.value)} placeholder="Any section" /></label>
              <button className="primary-small" type="button" onClick={saveAlert}>Create alert</button>
            </div>
            <div className="alert-list">
              {state.alerts.map((alert) => (
                <article key={alert.id}>
                  <div><strong>{alert.sectionQuery ?? "Any section"}</strong><span>≤ {alert.maxPrice ? money(alert.maxPrice) : "Any price"} · Qty {alert.quantity}</span></div>
                  <button type="button" aria-label="Delete alert" onClick={async () => { await send("DELETE_ALERT", { id: alert.id }); await refresh(); }}><Trash2 size={15} /></button>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "watchlist" && (
          <section>
            <div className="section-head"><div><span className="eyebrow">WATCH BOARD</span><h2>Saved listings</h2></div><Star size={18} /></div>
            <div className="listing-stack">
              {watched.map((listing) => (
                <ListingRow key={listingStorageKey(listing)} listing={listing} watched onWatch={() => toggleWatch(listing)} />
              ))}
              {!watched.length && <div className="empty-panel">Star a listing to keep it on this board.</div>}
            </div>
          </section>
        )}

        {tab === "history" && (
          <section>
            <div className="section-head"><div><span className="eyebrow">SCAN LOG</span><h2>Recent activity</h2></div><RefreshCw size={18} /></div>
            <div className="history-list">
              {state.scans.map(({ batch, receivedAt }) => (
                <article key={`${batch.scanId}-${receivedAt}`}>
                  <span className={`history-status ${batch.status}`} />
                  <div><strong>{batch.source}</strong><span>{batch.listings.length} listings · {batch.completeness}</span></div>
                  <time>{new Date(receivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </article>
              ))}
              {!state.scans.length && <div className="empty-panel">No scans have run yet.</div>}
            </div>
          </section>
        )}

        {tab === "dashboard" && (
          <section>
            <div className="section-head"><div><span className="eyebrow">CLOUD LINK</span><h2>Private dashboard</h2></div><CloudUpload size={18} /></div>
            <div className="form-grid">
              <label>Dashboard URL<input value={state.settings.apiBaseUrl} onChange={(event) => updateSettings({ apiBaseUrl: event.target.value })} /></label>
              {!state.settings.extensionToken && (
                <label>One-time connection code<input value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="ABC123" autoComplete="off" maxLength={12} autoFocus /></label>
              )}
              {!state.settings.extensionToken ? (
                <button className="primary-small" type="button" onClick={claimExtension} disabled={busy}>
                  {busy ? "Connecting…" : "Connect extension"}
                </button>
              ) : (
                <>
                  <div className="connected-card"><ShieldCheck size={18} /><div><strong>Extension connected</strong><span>Token stored only in Chrome local storage</span></div></div>
                  <button className="primary-small" type="button" onClick={async () => {
                    const result = await send<{ ok: boolean; error?: string }>("DISCONNECT_EXTENSION");
                    setMessage(result.ok ? "Extension disconnected and token revoked" : result.error ?? "Disconnect failed");
                    await refresh();
                  }}>Disconnect and revoke token</button>
                </>
              )}
              <label className="consent-toggle">
                <input type="checkbox" checked={state.settings.contributionEnabled} onChange={(event) => updateSettings({
                  contributionEnabled: event.target.checked,
                  consentAcceptedAt: event.target.checked ? new Date().toISOString() : null
                })} />
                <span><strong>Contribute scans</strong>Send captured listing fields to your private dashboard. Cookies and account data are never included.</span>
              </label>
              <label className="consent-toggle">
                <input
                  type="checkbox"
                  checked={state.settings.autoScanEnabled}
                  onChange={(event) => updateSettings({ autoScanEnabled: event.target.checked })}
                />
                <span><strong>Automatic deal monitoring</strong>While Chrome is running, open supported event pages in inactive tabs, scan them, and close them automatically.</span>
              </label>
              <a className="dashboard-link" href={state.settings.apiBaseUrl} target="_blank" rel="noreferrer"><Settings size={16} /> Open dashboard</a>
            </div>
            {message && <p className="inline-message" aria-live="polite">{message}</p>}
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
