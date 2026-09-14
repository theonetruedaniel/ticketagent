begin;
select plan(5);

select is(public.freshness_state(now() - interval '5 minutes'), 'fresh', 'under 15 minutes is fresh');
select is(public.freshness_state(now() - interval '30 minutes'), 'aging', '15 to 60 minutes is aging');
select is(public.freshness_state(now() - interval '90 minutes'), 'stale', 'over 60 minutes is stale');
select has_unique('public', 'scan_runs', array['owner_id', 'scan_id'], 'scan batches are idempotent per owner');
select has_unique('public', 'listings', array['owner_id', 'source', 'listing_id'], 'listing identity is stable per source and owner');

select * from finish();
rollback;
