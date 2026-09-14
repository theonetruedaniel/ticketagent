create index listings_owner_available_observed_idx
  on public.listings(owner_id, observed_at desc)
  where available is true;

create index listing_observations_owner_observed_idx
  on public.listing_observations(owner_id, observed_at desc);
