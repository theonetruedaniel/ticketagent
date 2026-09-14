create table public.auth_email_cooldowns (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  last_sent_at timestamptz not null
);

alter table public.auth_email_cooldowns enable row level security;
revoke all on public.auth_email_cooldowns from anon, authenticated;
