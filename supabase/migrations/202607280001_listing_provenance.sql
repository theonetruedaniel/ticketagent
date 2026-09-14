create type public.collection_mode as enum (
  'official_api',
  'licensed_feed',
  'connector_alert',
  'browser_observed',
  'summary_only',
  'access_pending'
);

create type public.price_basis as enum ('all_in', 'before_fees', 'unknown');

alter table public.scan_runs
  add column collection_mode public.collection_mode not null default 'browser_observed';

alter table public.listings
  add column collection_mode public.collection_mode not null default 'browser_observed',
  add column price_basis public.price_basis not null default 'unknown',
  add column provider_observed_at timestamptz;

alter table public.listing_observations
  add column collection_mode public.collection_mode not null default 'browser_observed',
  add column price_basis public.price_basis not null default 'unknown',
  add column provider_observed_at timestamptz;

update public.source_events
set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
  'collectionMode',
  case source
    when 'SeatGeek' then 'summary_only'
    when 'StubHub' then 'access_pending'
    else 'browser_observed'
  end,
  'browserAutomationAllowed',
  case when source in ('SeatGeek', 'StubHub') then false else true end
)
where coalesce(summary->>'collectionMode', '') not in (
  'official_api',
  'licensed_feed',
  'connector_alert',
  'browser_observed',
  'summary_only',
  'access_pending'
);

create index listings_price_provenance_idx
  on public.listings(owner_id, event_id, price_basis, observed_at desc)
  where available = true;
