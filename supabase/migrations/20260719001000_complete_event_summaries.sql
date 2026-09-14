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
  owner_events.owner_id,
  owner_events.event_id,
  coalesce(inventory.inventory_count, 0) as inventory_count,
  inventory.minimum_price,
  coalesce(freshness.source_freshness, '{}'::jsonb) as source_freshness,
  case
    when historical.previous_minimum > 0 and inventory.minimum_price is not null
    then round(
      ((inventory.minimum_price - historical.previous_minimum) / historical.previous_minimum) * 100,
      1
    )
    else null
  end as trend_percent
from owner_events
left join inventory using (owner_id, event_id)
left join freshness using (owner_id, event_id)
left join historical using (owner_id, event_id);

grant select on public.event_summaries to authenticated;
