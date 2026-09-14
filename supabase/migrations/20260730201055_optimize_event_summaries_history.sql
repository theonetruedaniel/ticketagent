create or replace view public.event_summaries
with (security_invoker = true)
as
with owner_events as (
  select profile.id as owner_id, event.id as event_id
  from public.profiles profile
  cross join public.events event
),
inventory as (
  select
    listings.owner_id,
    listings.event_id,
    count(*) filter (where listings.available) as inventory_count,
    min(listings.price_per_ticket) filter (
      where listings.available and listings.all_in
    ) as minimum_price
  from public.listings
  group by listings.owner_id, listings.event_id
),
freshness_rows as (
  select
    listings.owner_id,
    listings.event_id,
    listings.source,
    max(listings.observed_at) as observed_at
  from public.listings
  group by listings.owner_id, listings.event_id, listings.source

  union all

  select
    profile.id,
    source_event.event_id,
    source_event.source,
    source_event.last_observed_at
  from public.profiles profile
  cross join public.source_events source_event
  where source_event.last_observed_at is not null
),
freshness as (
  select
    per_source.owner_id,
    per_source.event_id,
    jsonb_object_agg(per_source.source, per_source.observed_at) as source_freshness
  from (
    select
      freshness_rows.owner_id,
      freshness_rows.event_id,
      freshness_rows.source,
      max(freshness_rows.observed_at) as observed_at
    from freshness_rows
    group by
      freshness_rows.owner_id,
      freshness_rows.event_id,
      freshness_rows.source
  ) per_source
  group by per_source.owner_id, per_source.event_id
),
historical as (
  select
    listing_observations.owner_id,
    listing_observations.event_id,
    min(listing_observations.price_per_ticket) as previous_minimum
  from public.listing_observations
  where listing_observations.all_in
    and listing_observations.observed_at >= now() - interval '30 hours'
    and listing_observations.observed_at <= now() - interval '18 hours'
  group by listing_observations.owner_id, listing_observations.event_id
)
select
  owner_events.owner_id,
  owner_events.event_id,
  coalesce(inventory.inventory_count, 0::bigint) as inventory_count,
  inventory.minimum_price,
  coalesce(freshness.source_freshness, '{}'::jsonb) as source_freshness,
  case
    when historical.previous_minimum > 0::numeric
      and inventory.minimum_price is not null
      then round(
        (inventory.minimum_price - historical.previous_minimum)
          / historical.previous_minimum
          * 100::numeric,
        1
      )
    else null::numeric
  end as trend_percent
from owner_events
left join inventory using (owner_id, event_id)
left join freshness using (owner_id, event_id)
left join historical using (owner_id, event_id);
