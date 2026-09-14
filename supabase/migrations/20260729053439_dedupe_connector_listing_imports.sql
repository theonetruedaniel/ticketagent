alter table public.connector_listing_imports
  add column scan_id text
  generated always as (batch ->> 'scanId') stored;

alter table public.connector_listing_imports
  alter column scan_id set not null;

create unique index connector_listing_imports_source_scan_idx
  on public.connector_listing_imports(source, scan_id);
