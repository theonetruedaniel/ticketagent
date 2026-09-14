create extension if not exists pgcrypto;

create type public.marketplace_source as enum ('SeatGeek', 'StubHub', 'TickPick', 'GameTime');
create type public.scan_completeness as enum ('partial', 'full');
create type public.scan_status as enum ('complete', 'partial', 'blocked', 'error');
create type public.outbox_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  alerts_enabled boolean not null default true,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  mlb_game_pk text not null unique,
  home_team text not null default 'Atlanta Braves',
  away_team text not null,
  opponent text not null,
  starts_at timestamptz not null,
  venue text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint braves_home_only check (home_team = 'Atlanta Braves'),
  constraint truist_only check (venue = 'Truist Park')
);

create table public.source_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source public.marketplace_source not null,
  source_event_id text not null,
  last_observed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, source_event_id)
);

create table public.extension_connection_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  device_name text not null default 'Chrome extension',
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  extension_token_id uuid references public.extension_tokens(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  scan_id text not null,
  source public.marketplace_source not null,
  source_event_id text not null,
  completeness public.scan_completeness not null,
  status public.scan_status not null,
  status_message text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  listing_count integer not null default 0,
  page_url text not null,
  extension_version text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, scan_id)
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  mlb_game_pk text,
  source public.marketplace_source not null,
  source_event_id text not null,
  listing_id text not null,
  first_seen_at timestamptz not null,
  observed_at timestamptz not null,
  unavailable_at timestamptz,
  available boolean not null default true,
  last_scan_id text not null,
  last_scan_completeness public.scan_completeness not null,
  section text not null,
  row_label text,
  seat_from text,
  seat_to text,
  quantity_min integer not null,
  quantity_max integer not null,
  price_per_ticket numeric(12,2) not null,
  currency char(3) not null default 'USD',
  all_in boolean not null,
  accessible boolean not null default false,
  limited_view boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
  deep_link text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source, listing_id),
  constraint quantity_range check (quantity_min >= 1 and quantity_max >= quantity_min),
  constraint positive_price check (price_per_ticket > 0)
);

create index listings_event_price_idx on public.listings(owner_id, event_id, available, price_per_ticket);
create index listings_source_freshness_idx on public.listings(owner_id, source, observed_at desc);

create table public.listing_observations (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  scan_id text not null,
  source public.marketplace_source not null,
  listing_id text not null,
  observed_at timestamptz not null,
  price_per_ticket numeric(12,2) not null,
  quantity_min integer not null,
  quantity_max integer not null,
  all_in boolean not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, scan_id, source, listing_id)
);

create index observations_history_idx on public.listing_observations(owner_id, source, listing_id, observed_at desc);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  rule_type text not null check (rule_type in ('price', 'priceDrop', 'newListing')),
  name text not null,
  enabled boolean not null default true,
  email_enabled boolean not null default true,
  source public.marketplace_source,
  section_query text,
  quantity integer not null default 1 check (quantity between 1 and 20),
  max_price numeric(12,2),
  accessible boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  alert_rule_id uuid references public.alert_rules(id) on delete set null,
  listing_source public.marketplace_source not null,
  listing_id text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);

create index email_outbox_delivery_idx on public.email_outbox(status, next_attempt_at);
create index email_outbox_owner_idx on public.email_outbox(owner_id, created_at desc);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  source public.marketplace_source not null,
  listing_id text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, source, listing_id)
);

create or replace view public.event_summaries
with (security_invoker = true)
as
with inventory as (
  select
    owner_id,
    event_id,
    count(*) filter (where available) as inventory_count,
    min(price_per_ticket) filter (where available and all_in) as minimum_price
  from public.listings
  group by owner_id, event_id
),
freshness_rows as (
  select owner_id, event_id, source, max(observed_at) as observed_at
  from public.listings
  group by owner_id, event_id, source
  union all
  select profile.id, source_event.event_id, source_event.source, source_event.last_observed_at
  from public.profiles profile
  cross join public.source_events source_event
  where source_event.last_observed_at is not null
),
freshness as (
  select owner_id, event_id, jsonb_object_agg(source, observed_at) as source_freshness
  from (
    select owner_id, event_id, source, max(observed_at) as observed_at
    from freshness_rows
    group by owner_id, event_id, source
  ) per_source
  group by owner_id, event_id
),
historical as (
  select
    owner_id,
    event_id,
    min(price_per_ticket) filter (
      where all_in
        and observed_at between now() - interval '30 hours' and now() - interval '18 hours'
    ) as previous_minimum
  from public.listing_observations
  group by owner_id, event_id
)
select
  inventory.owner_id,
  inventory.event_id,
  inventory.inventory_count,
  inventory.minimum_price,
  coalesce(freshness.source_freshness, '{}'::jsonb) as source_freshness,
  case
    when historical.previous_minimum > 0
    then round(
      ((inventory.minimum_price - historical.previous_minimum) / historical.previous_minimum) * 100,
      1
    )
    else null
  end as trend_percent
from inventory
left join freshness using (owner_id, event_id)
left join historical using (owner_id, event_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.source_events enable row level security;
alter table public.extension_connection_codes enable row level security;
alter table public.extension_tokens enable row level security;
alter table public.scan_runs enable row level security;
alter table public.listings enable row level security;
alter table public.listing_observations enable row level security;
alter table public.alert_rules enable row level security;
alter table public.email_outbox enable row level security;
alter table public.watchlists enable row level security;

create policy "own profile select" on public.profiles for select
  to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update
  to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy "authenticated events read" on public.events for select to authenticated using (true);
create policy "authenticated source events read" on public.source_events for select to authenticated using (true);
create policy "own scan runs" on public.scan_runs for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own listings" on public.listings for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own observations" on public.listing_observations for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own alert rules select" on public.alert_rules for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own alert rules insert" on public.alert_rules for insert
  to authenticated with check ((select auth.uid()) = owner_id);
create policy "own alert rules update" on public.alert_rules for update
  to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "own alert rules delete" on public.alert_rules for delete
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own outbox" on public.email_outbox for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own watchlists select" on public.watchlists for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy "own watchlists insert" on public.watchlists for insert
  to authenticated with check ((select auth.uid()) = owner_id);
create policy "own watchlists delete" on public.watchlists for delete
  to authenticated using ((select auth.uid()) = owner_id);

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.events, public.source_events, public.scan_runs, public.listings,
  public.listing_observations, public.email_outbox to authenticated;
grant select, insert, update, delete on public.alert_rules to authenticated;
grant select, insert, delete on public.watchlists to authenticated;
grant select on public.event_summaries to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.extension_tokens, public.extension_connection_codes from anon, authenticated;

create or replace function public.freshness_state(observed_at timestamptz, reference_at timestamptz default now())
returns text language sql immutable
as $$
  select case
    when reference_at - observed_at < interval '15 minutes' then 'fresh'
    when reference_at - observed_at < interval '60 minutes' then 'aging'
    else 'stale'
  end;
$$;
