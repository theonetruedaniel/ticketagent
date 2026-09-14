"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  History,
  Mail,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Ticket,
  Trash2,
  Wifi,
  X
} from "lucide-react";
import {
  dealScore,
  freshnessState,
  listingCanFulfillQuantity,
  sectionProfile,
  type AlertRule,
  type NormalizedListing
} from "@ticket-agent/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardEvent, DashboardHistoryPoint } from "@/lib/demo-data";
import VenueMap from "./venue-map";

type Sort = "deal" | "price-low" | "price-high" | "fresh";
type BooleanFilter = "all" | "yes" | "no";

const sourceLabels = {
  SeatGeek: "SeatGeek",
  StubHub: "StubHub",
  TickPick: "TickPick",
  GameTime: "GameTime"
} as const;

function money(value: number | null, currency = "USD") {
  if (value == null) return "\u2014";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function relativeTime(value: string, snapshotAt: number) {
  const minutes = Math.max(0, Math.floor((snapshotAt - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function listingKey(listing: Pick<NormalizedListing, "source" | "listingId">) {
  return `${listing.source}:${listing.listingId}`;
}

function exportCsv(listings: NormalizedListing[]) {
  const header = [
    "source", "section", "deck", "row", "quantity_min", "quantity_max",
    "all_in_price", "currency", "fee_status", "accessible", "limited_view",
    "observed_at", "url"
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = listings.map((item) =>
    [
      item.source,
      item.section,
      sectionProfile(item.section).zone,
      item.row,
      item.quantityMin,
      item.quantityMax,
      item.pricePerTicket,
      item.currency,
      item.allIn ? "all-in" : "fees-unconfirmed",
      item.accessible,
      item.limitedView,
      item.observedAt,
      item.deepLink
    ].map(escape).join(",")
  );
  const blob = new Blob([[header.join(","), ...rows].join("\n")], {
    type: "text/csv;charset=utf-8"
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `braves-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function Dashboard({
  initialEvents,
  initialListings,
  initialHistory,
  initialWatchlist,
  initialAlerts,
  initialAlertsEnabled,
  extensionConnected,
  extensionLastActiveAt,
  snapshotAt,
  identity
}: {
  initialEvents: DashboardEvent[];
  initialListings: NormalizedListing[];
  initialHistory: DashboardHistoryPoint[];
  initialWatchlist: string[];
  initialAlerts: AlertRule[];
  initialAlertsEnabled: boolean;
  extensionConnected: boolean;
  extensionLastActiveAt: string | null;
  snapshotAt: string;
  identity: { email: string; demo: boolean };
}) {
  const router = useRouter();
  const snapshotTime = Date.parse(snapshotAt);
  const [selectedGame, setSelectedGame] = useState(initialEvents[0]?.mlbGamePk ?? "");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [deck, setDeck] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const [maxPrice, setMaxPrice] = useState("");
  const [accessible, setAccessible] = useState<BooleanFilter>("all");
  const [limitedView, setLimitedView] = useState<BooleanFilter>("all");
  const [recency, setRecency] = useState("all");
  const [sort, setSort] = useState<Sort>("deal");
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set(initialWatchlist));
  const [alerts, setAlerts] = useState(initialAlerts);
  const [alertsEnabled, setAlertsEnabled] = useState(initialAlertsEnabled);
  const [filterOpen, setFilterOpen] = useState(false);
  const [connectionCode, setConnectionCode] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selectedListingKey, setSelectedListingKey] = useState<string | null>(null);
  const [hoveredListingKey, setHoveredListingKey] = useState<string | null>(null);
  const inventoryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const refresh = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(refresh);
  }, [router]);

  const gameListings = useMemo(
    () => initialListings.filter((listing) => listing.mlbGamePk === selectedGame),
    [initialListings, selectedGame]
  );

  const sectionMedians = useMemo(() => {
    const grouped = new Map<string, number[]>();
    gameListings.forEach((listing) => {
      const key = sectionProfile(listing.section).zone;
      grouped.set(key, [...(grouped.get(key) ?? []), listing.pricePerTicket]);
    });
    return new Map(
      [...grouped].map(([key, prices]) => [
        key,
        [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      ])
    );
  }, [gameListings]);

  const visible = useMemo(() => {
    const ageLimit = recency === "all" ? null : Number(recency) * 60_000;
    return gameListings
      .filter((listing) => {
        const profile = sectionProfile(listing.section);
        const haystack = `${listing.section} ${listing.row} ${listing.notes.join(" ")} ${profile.label}`.toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (source === "all" || listing.source === source) &&
          (deck === "all" || profile.zone === deck) &&
          listingCanFulfillQuantity(listing, quantity) &&
          (!maxPrice || listing.pricePerTicket <= Number(maxPrice)) &&
          (accessible === "all" || listing.accessible === (accessible === "yes")) &&
          (limitedView === "all" || listing.limitedView === (limitedView === "yes")) &&
          (ageLimit == null || snapshotTime - Date.parse(listing.observedAt) <= ageLimit)
        );
      })
      .sort((a, b) => {
        if (sort === "price-low") return a.pricePerTicket - b.pricePerTicket;
        if (sort === "price-high") return b.pricePerTicket - a.pricePerTicket;
        if (sort === "fresh") return Date.parse(b.observedAt) - Date.parse(a.observedAt);
        const aProfile = sectionProfile(a.section);
        const bProfile = sectionProfile(b.section);
        return (
          dealScore(b, sectionMedians.get(bProfile.zone) ?? b.pricePerTicket) -
          dealScore(a, sectionMedians.get(aProfile.zone) ?? a.pricePerTicket)
        );
      });
  }, [
    accessible, deck, gameListings, limitedView, maxPrice, query, quantity,
    recency, sectionMedians, snapshotTime, sort, source
  ]);

  const selectedEvent = initialEvents.find((event) => event.mlbGamePk === selectedGame);
  const selectedListing = gameListings.find((listing) => listingKey(listing) === selectedListingKey);
  const mappedListing =
    gameListings.find((listing) => listingKey(listing) === hoveredListingKey) ??
    selectedListing ??
    visible[0] ??
    null;
  const allInGameListings = gameListings.filter((listing) => listing.allIn);
  const cheapest = allInGameListings.length
    ? Math.min(...allInGameListings.map((listing) => listing.pricePerTicket))
    : null;
  const allInListings = initialListings.filter((listing) => listing.allIn);
  const overallBest = allInListings.length
    ? Math.min(...allInListings.map((listing) => listing.pricePerTicket))
    : null;
  const recentSources = Object.keys(sourceLabels).filter((sourceName) =>
    initialEvents.some((event) => {
      const observedAt =
        event.freshness[sourceName] ??
        event.freshness[sourceName.toLowerCase()];
      return (
        observedAt != null &&
        snapshotTime - Date.parse(observedAt) < 60 * 60_000
      );
    })
  ).length;
  const monitoringState = recentSources > 0
    ? "MONITORING"
    : extensionConnected
      ? "AWAITING FIRST SCAN"
      : "EXTENSION OFFLINE";
  const selectedGameAlerts = alerts.filter(
    (alert) => alert.enabled && alert.mlbGamePk === selectedGame
  );

  function resetFilters() {
    setQuery("");
    setSource("all");
    setDeck("all");
    setQuantity(1);
    setMaxPrice("");
    setAccessible("all");
    setLimitedView("all");
    setRecency("all");
  }

  function selectGameAndScroll(gamePk: string) {
    setSelectedGame(gamePk);
    setSelectedListingKey(null);
    window.requestAnimationFrame(() => {
      inventoryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }

  async function toggleWatch(listing: NormalizedListing) {
    const key = listingKey(listing);
    const watched = !watchlist.has(key);
    setWatchlist((current) => {
      const next = new Set(current);
      if (watched) next.add(key);
      else next.delete(key);
      return next;
    });
    const response = await fetch("/api/v1/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: listing.source,
        listingId: listing.listingId,
        watched
      })
    });
    if (!response.ok) {
      setWatchlist((current) => {
        const next = new Set(current);
        if (watched) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  }

  async function saveAlert(rule: AlertRule) {
    const response = await fetch("/api/v1/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    });
    if (!response.ok) throw new Error("Could not save alert");
    setAlerts((current) => [...current.filter((item) => item.id !== rule.id), rule]);
  }

  async function deleteAlert(id: string) {
    const response = await fetch(`/api/v1/alerts?id=${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (response.ok) setAlerts((current) => current.filter((item) => item.id !== id));
  }

  async function toggleEmailAlerts() {
    const next = !alertsEnabled;
    const response = await fetch("/api/v1/preferences/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next })
    });
    if (response.ok) setAlertsEnabled(next);
  }

  async function createConnectionCode() {
    setConnectionOpen(true);
    setConnectionCode(null);
    const response = await fetch("/api/v1/extension/code", { method: "POST" });
    const payload = (await response.json()) as { code?: string };
    setConnectionCode(payload.code ?? "ERROR");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Ticket size={19} strokeWidth={2.2} /></div>
          <div><strong>BRAVES TICKET OPS</strong><span>PRIVATE INVENTORY CONSOLE</span></div>
        </div>
        <div className="top-actions">
          <div className={`live-pill ${recentSources > 0 ? "active" : "waiting"}`}><span /> {monitoringState}</div>
          <button className="connect-button" onClick={createConnectionCode}>
            {extensionConnected ? "EXTENSION CONNECTED" : "CONNECT EXTENSION"}
          </button>
          <button className="icon-button" aria-label="Manage alerts" onClick={() => setAlertsOpen(true)}>
            <Bell size={18} /><i>{alerts.filter((alert) => alert.enabled).length}</i>
          </button>
          <button className="account" onClick={toggleEmailAlerts} title="Toggle email delivery">
            <span className="avatar">{identity.email.slice(0, 1).toUpperCase()}</span>
            <span>{identity.demo ? "Local mode" : identity.email}</span>
            <small>{alertsEnabled ? "EMAIL ON" : "EMAIL OFF"}</small>
          </button>
          {!identity.demo && (
            <form action="/auth/signout" method="post">
              <button className="signout-button" type="submit">SIGN OUT</button>
            </form>
          )}
        </div>
      </header>

      <section className="masthead">
        <div>
          <p className="eyebrow">TRUIST PARK / HOME INVENTORY</p>
          <h1>Find the seat.<br /><em>Beat the market.</em></h1>
        </div>
          <div className="mast-metrics">
          <div><span>Listings tracked</span><strong>{initialListings.length.toLocaleString()}</strong></div>
          <div><span>Sources recent</span><strong>{recentSources}<span>/4</span></strong></div>
          <div><span>Best all-in</span><strong>{money(overallBest)}</strong></div>
        </div>
      </section>

      <section className="game-rail" aria-label="Upcoming games">
        {initialEvents.map((event) => {
          const active = event.mlbGamePk === selectedGame;
          return (
            <button
              key={event.id}
              className={`game-card ${active ? "active" : ""}`}
              aria-controls="game-inventory"
              aria-pressed={active}
              onClick={() => selectGameAndScroll(event.mlbGamePk)}
            >
              <div className="game-date">
                <CalendarDays size={15} />
                {new Intl.DateTimeFormat("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
                }).format(new Date(event.startsAt))}
              </div>
              <h2>vs. {event.opponent}</h2>
              <div className="game-price">
                <span>FROM</span><strong>{money(event.minimumPrice)}</strong>
                {event.trendPercent != null && (
                  <small className={event.trendPercent <= 0 ? "down" : "up"}>
                    {event.trendPercent <= 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                    {Math.abs(event.trendPercent)}%
                  </small>
                )}
              </div>
              <div className="game-meta">{event.inventoryCount} listings <ChevronRight size={15} /></div>
            </button>
          );
        })}
      </section>

      <section className="status-strip">
        <div className="status-title"><Radio size={16} /> SOURCE FRESHNESS</div>
        {Object.keys(sourceLabels).map((name) => {
          const freshness = selectedEvent?.freshness ?? {};
          const seenAt = freshness[name] ?? freshness[name.toLowerCase()] ?? null;
          const state = seenAt ? freshnessState(seenAt) : "stale";
          return (
            <div className="source-state" key={name}>
              <span className={`state-dot ${state}`} />
              <b>{sourceLabels[name as keyof typeof sourceLabels]}</b>
              <small>{seenAt ? relativeTime(seenAt, snapshotTime) : "no scan"}</small>
            </div>
          );
        })}
        <div className="freshness-key">
          <span><i className="fresh" /> &lt;15m</span>
          <span><i className="aging" /> 15{"\u2013"}60m</span>
          <span><i className="stale" /> &gt;60m</span>
        </div>
      </section>

      <section
        className="workspace"
        id="game-inventory"
        ref={inventoryRef}
        aria-label="Selected game inventory"
      >
        <aside className={`filter-panel ${filterOpen ? "open" : ""}`}>
          <div className="panel-title">
            <span><Settings2 size={16} /> FILTER INVENTORY</span>
            <button onClick={resetFilters}>RESET</button>
          </div>
          <label>SEARCH SECTION / ROW
            <div className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. 122, Delta Club" />
            </div>
          </label>
          <label>SOURCE
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">All marketplaces</option>
              {Object.entries(sourceLabels).map(([value, label]) =>
                <option value={value} key={value}>{label}</option>
              )}
            </select>
          </label>
          <label>DECK / ZONE
            <select value={deck} onChange={(event) => setDeck(event.target.value)}>
              <option value="all">All decks</option>
              <option value="premium">Premium</option>
              <option value="infield">Infield</option>
              <option value="baseline">Baseline</option>
              <option value="outfield">Outfield</option>
              <option value="upper">Upper</option>
            </select>
          </label>
          <label>TICKETS NEEDED
            <div className="quantity-grid">
              {[1, 2, 3, 4].map((value) =>
                <button className={quantity === value ? "active" : ""} onClick={() => setQuantity(value)} key={value}>
                  {value}{value === 4 ? "+" : ""}
                </button>
              )}
            </div>
          </label>
          <label>MAX ALL-IN PRICE
            <div className="money-input">
              <span>$</span>
              <input type="number" min="0" placeholder="No limit" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} />
            </div>
          </label>
          <label>ACCESSIBILITY
            <select value={accessible} onChange={(event) => setAccessible(event.target.value as BooleanFilter)}>
              <option value="all">Any</option><option value="yes">Accessible only</option><option value="no">Standard only</option>
            </select>
          </label>
          <label>LIMITED VIEW
            <select value={limitedView} onChange={(event) => setLimitedView(event.target.value as BooleanFilter)}>
              <option value="all">Any</option><option value="no">Exclude limited view</option><option value="yes">Limited view only</option>
            </select>
          </label>
          <label>RECENCY
            <select value={recency} onChange={(event) => setRecency(event.target.value)}>
              <option value="all">Any age</option><option value="15">Fresh under 15m</option><option value="60">Seen under 60m</option>
            </select>
          </label>
          <div className="filter-note"><Check size={15} />Prices are normalized per ticket. Unconfirmed fees remain labeled.</div>
        </aside>

        <div className="inventory-panel">
          <div className="inventory-head">
            <div>
              <p>{selectedEvent ? `VS. ${selectedEvent.opponent.toUpperCase()}` : "UPCOMING GAME"}</p>
              <h2>Live inventory <span>{visible.length}</span></h2>
            </div>
            <div className="inventory-actions">
              <button className="mobile-filter" onClick={() => setFilterOpen((value) => !value)}><Filter size={16} /> Filters</button>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort listings">
                <option value="deal">Best deal</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                <option value="fresh">Most recent</option>
              </select>
              <button onClick={() => exportCsv(visible)}><Download size={16} /> CSV</button>
            </div>
          </div>

          <div className="summary-row">
            <div><CircleDollarSign size={17} /><span>Lowest all-in</span><strong>{money(cheapest)}</strong></div>
            <div><Wifi size={17} /><span>Inventory shown</span><strong>{visible.length}</strong></div>
            <div><Star size={17} /><span>Watched</span><strong>{watchlist.size}</strong></div>
          </div>

          {selectedEvent && (
            <GameAlertBuilder
              event={selectedEvent}
              existingCount={selectedGameAlerts.length}
              emailEnabled={alertsEnabled}
              onAlert={saveAlert}
              onManage={() => setAlertsOpen(true)}
            />
          )}

          <VenueMap listing={mappedListing} />

          <div className="listing-table" role="table" aria-label="Ticket listings">
            <div className="table-header" role="row">
              <span>SOURCE</span><span>LOCATION</span><span>QTY</span><span>ALL-IN / EA.</span><span>DEAL</span><span>SEEN</span><span />
            </div>
            {visible.map((listing) => {
              const profile = sectionProfile(listing.section);
              const score = dealScore(listing, sectionMedians.get(profile.zone) ?? listing.pricePerTicket);
              const watched = watchlist.has(listingKey(listing));
              return (
                <article
                  className={`listing-row ${listingKey(listing) === hoveredListingKey ? "map-active" : ""}`}
                  role="row"
                  key={listingKey(listing)}
                  onMouseEnter={() => setHoveredListingKey(listingKey(listing))}
                  onMouseLeave={() => setHoveredListingKey(null)}
                  onFocus={() => setHoveredListingKey(listingKey(listing))}
                  onBlur={() => setHoveredListingKey(null)}
                >
                  <div className={`source-logo ${listing.source.toLowerCase()}`}>
                    {sourceLabels[listing.source].slice(0, 2).toUpperCase()}
                  </div>
                  <button className="location location-button" onClick={() => setSelectedListingKey(listingKey(listing))}>
                    <strong>Section {listing.section}</strong>
                    <span>Row {listing.row ?? "TBD"} · {profile.label}</span>
                    <div className="badges">
                      {listing.accessible && <small>ACCESSIBLE</small>}
                      {listing.limitedView && <small className="warning">LIMITED VIEW</small>}
                      {!listing.allIn && <small className="warning">FEES TBD</small>}
                    </div>
                  </button>
                  <div className="qty">{listing.quantityMin === listing.quantityMax ? listing.quantityMax : `${listing.quantityMin}–${listing.quantityMax}`}</div>
                  <div className="price"><strong>{money(listing.pricePerTicket, listing.currency)}</strong><span>{listing.currency} · {listing.allIn ? "fees incl." : "base price"}</span></div>
                  <div className={`deal-score ${score >= 75 ? "hot" : score >= 58 ? "good" : ""}`}><b>{score}</b><span>/100</span></div>
                  <div className="seen"><Clock3 size={13} /> {relativeTime(listing.observedAt, snapshotTime)}</div>
                  <div className="row-actions">
                    <button onClick={() => void toggleWatch(listing)} className={watched ? "watched" : ""} aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}>
                      <Star size={17} fill={watched ? "currentColor" : "none"} />
                    </button>
                    <a href={listing.deepLink} target="_blank" rel="noreferrer" aria-label="Open marketplace listing"><ExternalLink size={17} /></a>
                  </div>
                </article>
              );
            })}
            {!visible.length && (
              <div className="empty-state">
                <AlertTriangle size={24} />
                <strong>{gameListings.length ? "No listings match these filters." : "No marketplace inventory has been captured yet."}</strong>
                <span>{gameListings.length
                  ? "Clear a price, source, deck, quantity, or recency filter."
                  : extensionConnected
                    ? `Automatic checks will run while Chrome is open${extensionLastActiveAt ? `; last extension activity ${relativeTime(extensionLastActiveAt, snapshotTime)} ago` : ""}. Save a deal alert above to give this game five-minute priority.`
                    : "Connect the Chrome extension, enable scan contribution and automatic monitoring, then save a deal alert."
                }</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {identity.demo && <div className="demo-banner">LOCAL DEMO DATA <span>Connect Supabase to ingest extension scans and enable private authentication.</span></div>}

      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          peers={gameListings.filter((item) => sectionProfile(item.section).zone === sectionProfile(selectedListing.section).zone)}
          history={initialHistory.filter((point) => point.source === selectedListing.source && point.listingId === selectedListing.listingId)}
          watched={watchlist.has(listingKey(selectedListing))}
          onWatch={() => void toggleWatch(selectedListing)}
          onAlert={saveAlert}
          onClose={() => setSelectedListingKey(null)}
        />
      )}
      {alertsOpen && (
        <AlertManager
          alerts={alerts}
          emailEnabled={alertsEnabled}
          onToggleEmail={() => void toggleEmailAlerts()}
          onDelete={deleteAlert}
          onClose={() => setAlertsOpen(false)}
        />
      )}
      {connectionOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConnectionOpen(false)}>
          <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">PRIVATE DEVICE PAIRING</p>
            <h2 id="connect-title">Connect the Chrome extension</h2>
            <p>Enter this one-time code in the extension Dashboard tab. It expires in ten minutes and can only be claimed once.</p>
            <div className="connection-code" aria-live="polite">{connectionCode ?? "······"}</div>
            <div className="disclosure"><ShieldCheck size={16} />Uploading stays off until you enable “Contribute scans.” Only rendered ticket details are sent.</div>
            <button className="close-modal" onClick={() => setConnectionOpen(false)}>DONE</button>
          </section>
        </div>
      )}
    </main>
  );
}

function GameAlertBuilder({
  event,
  existingCount,
  emailEnabled,
  onAlert,
  onManage
}: {
  event: DashboardEvent;
  existingCount: number;
  emailEnabled: boolean;
  onAlert: (rule: AlertRule) => Promise<void>;
  onManage: () => void;
}) {
  const [maxPrice, setMaxPrice] = useState("50");
  const [section, setSection] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function armMonitor() {
    const price = Number(maxPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await onAlert({
        id: crypto.randomUUID(),
        type: "price",
        enabled: true,
        mlbGamePk: event.mlbGamePk,
        source: null,
        sectionQuery: section.trim() || null,
        quantity,
        maxPrice: price,
        accessible: null,
        emailEnabled: true
      });
      setSaved(true);
    } catch {
      setError("Could not arm monitor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`game-monitor ${existingCount ? "armed" : ""}`}>
      <div className="monitor-copy">
        <Bell size={17} />
        <div>
          <strong>{existingCount ? `Priority monitor armed (${existingCount})` : `Monitor deals vs. ${event.opponent}`}</strong>
          <span>{existingCount
            ? `This game is queued for five-minute browser checks. Email delivery is ${emailEnabled ? "on" : "off"}.`
            : "Get an email when a newly captured listing meets your seat, quantity, and all-in price rule."
          }</span>
        </div>
      </div>
      <div className="monitor-fields">
        <label>Section contains<input value={section} onChange={(item) => setSection(item.target.value)} placeholder="Any section" /></label>
        <label>Tickets<input type="number" min="1" max="20" value={quantity} onChange={(item) => setQuantity(Number(item.target.value))} /></label>
        <label>Max all-in<input type="number" min="1" value={maxPrice} onChange={(item) => setMaxPrice(item.target.value)} /></label>
        <button onClick={() => void armMonitor()} disabled={saving}>{saving ? "SAVING…" : saved ? "ARMED" : "ARM MONITOR"}</button>
        {existingCount > 0 && <button className="manage-monitor" onClick={onManage}>MANAGE</button>}
        {error && <span className="monitor-error">{error}</span>}
      </div>
    </section>
  );
}

function ListingDetail({
  listing,
  peers,
  history,
  watched,
  onWatch,
  onAlert,
  onClose
}: {
  listing: NormalizedListing;
  peers: NormalizedListing[];
  history: DashboardHistoryPoint[];
  watched: boolean;
  onWatch: () => void;
  onAlert: (rule: AlertRule) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<AlertRule["type"]>("price");
  const [maxPrice, setMaxPrice] = useState(String(Math.floor(listing.pricePerTicket)));
  const [quantity, setQuantity] = useState(1);
  const sourceMinimums = Object.keys(sourceLabels).map((source) => ({
    source,
    minimum: peers
      .filter((peer) => peer.source === source)
      .reduce<number | null>((minimum, peer) => minimum == null ? peer.pricePerTicket : Math.min(minimum, peer.pricePerTicket), null)
  }));

  async function createRule() {
    const rule: AlertRule = {
      id: crypto.randomUUID(),
      type,
      enabled: true,
      mlbGamePk: listing.mlbGamePk,
      source: null,
      sectionQuery: listing.section,
      quantity,
      maxPrice: type === "price" && maxPrice ? Number(maxPrice) : null,
      accessible: listing.accessible ? true : null,
      emailEnabled: true
    };
    await onAlert(rule);
  }

  return (
    <div className="modal-backdrop detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close listing details"><X size={18} /></button>
        <p className="eyebrow">{listing.source.toUpperCase()} / LISTING DETAIL</p>
        <h2 id="detail-title">Section {listing.section}, Row {listing.row ?? "TBD"}</h2>
        <div className="detail-price">{money(listing.pricePerTicket, listing.currency)}<span>{listing.allIn ? "all-in" : "fees unconfirmed"} per ticket</span></div>

        <div className="detail-grid">
          <section>
            <h3><History size={15} /> PRICE HISTORY</h3>
            <PriceSparkline points={history} />
            <div className="history-labels">
              <span>{history[0] ? new Date(history[0].observedAt).toLocaleDateString() : "No history yet"}</span>
              <span>{history.at(-1) ? money(history.at(-1)!.pricePerTicket, listing.currency) : ""}</span>
            </div>
          </section>
          <section>
            <h3><CircleDollarSign size={15} /> ZONE COMPARISON</h3>
            <div className="comparison-list">
              {sourceMinimums.map((item) => <div key={item.source}><span>{item.source}</span><b>{money(item.minimum, listing.currency)}</b></div>)}
            </div>
          </section>
        </div>

        <section className="alert-builder">
          <h3><Bell size={15} /> CREATE ALERT</h3>
          <div>
            <select value={type} onChange={(event) => setType(event.target.value as AlertRule["type"])}>
              <option value="price">Price at or below</option>
              <option value="priceDrop">Any price drop</option>
              <option value="newListing">New matching listing</option>
            </select>
            {type === "price" && <input aria-label="Alert maximum price" type="number" min="1" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} />}
            <input aria-label="Alert quantity" type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
            <button onClick={() => void createRule()}>SAVE ALERT</button>
          </div>
        </section>

        <div className="detail-actions">
          <button onClick={onWatch} className={watched ? "watched" : ""}><Star size={16} fill={watched ? "currentColor" : "none"} /> {watched ? "WATCHING" : "WATCH"}</button>
          <a href={listing.deepLink} target="_blank" rel="noreferrer">OPEN MARKETPLACE <ExternalLink size={15} /></a>
        </div>
      </section>
    </div>
  );
}

function PriceSparkline({ points }: { points: DashboardHistoryPoint[] }) {
  if (points.length < 2) return <div className="spark-empty">History begins after the next observation.</div>;
  const prices = points.map((point) => point.pricePerTicket);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(1, max - min);
  const coordinates = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 42 - ((point.pricePerTicket - min) / range) * 36;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 100 48" role="img" aria-label="Listing price history">
      <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AlertManager({
  alerts,
  emailEnabled,
  onToggleEmail,
  onDelete,
  onClose
}: {
  alerts: AlertRule[];
  emailEnabled: boolean;
  onToggleEmail: () => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="connection-modal alert-manager" role="dialog" aria-modal="true" aria-labelledby="alerts-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close alert manager"><X size={18} /></button>
        <p className="eyebrow">RULES / DELIVERY</p>
        <h2 id="alerts-title">Ticket alerts</h2>
        <button className={`email-toggle ${emailEnabled ? "active" : ""}`} onClick={onToggleEmail}>
          <Mail size={16} /> EMAIL DELIVERY {emailEnabled ? "ON" : "OFF"}
        </button>
        <div className="alert-list">
          {alerts.map((alert) => (
            <article key={alert.id}>
              <div><strong>{alert.type === "price" ? `At or below ${money(alert.maxPrice)}` : alert.type === "priceDrop" ? "Any price drop" : "New listing"}</strong>
                <span>Section {alert.sectionQuery || "any"} · {alert.quantity}+ tickets</span></div>
              <button onClick={() => void onDelete(alert.id)} aria-label="Delete alert"><Trash2 size={16} /></button>
            </article>
          ))}
          {!alerts.length && <p className="login-copy">Choose a game on the dashboard and arm a maximum-price monitor, or open a listing for a more specific rule.</p>}
        </div>
      </section>
    </div>
  );
}
