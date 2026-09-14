create type public.connector_import_status as enum (
  'pending',
  'processing',
  'processed',
  'failed'
);

create table public.connector_listing_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  source public.marketplace_source not null,
  source_event_id text not null,
  batch jsonb not null,
  status public.connector_import_status not null default 'pending',
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index connector_listing_imports_pending_idx
  on public.connector_listing_imports(created_at)
  where status = 'pending';

alter table public.connector_listing_imports enable row level security;
revoke all on public.connector_listing_imports from anon, authenticated;
