create policy "deny direct connection code access"
on public.extension_connection_codes
for select
to authenticated
using (false);

create policy "deny direct extension token access"
on public.extension_tokens
for select
to authenticated
using (false);

alter function public.freshness_state(timestamptz, timestamptz)
set search_path = '';

create index alert_rules_owner_event_idx
  on public.alert_rules(owner_id, event_id);
create index email_outbox_alert_rule_idx
  on public.email_outbox(alert_rule_id);
create index extension_connection_codes_owner_idx
  on public.extension_connection_codes(owner_id);
create index extension_tokens_owner_idx
  on public.extension_tokens(owner_id);
create index listing_observations_event_idx
  on public.listing_observations(event_id);
create index listings_event_idx
  on public.listings(event_id);
create index scan_runs_event_idx
  on public.scan_runs(event_id);
create index scan_runs_extension_token_idx
  on public.scan_runs(extension_token_id);
create index source_events_event_idx
  on public.source_events(event_id);
create index watchlists_event_idx
  on public.watchlists(event_id);
