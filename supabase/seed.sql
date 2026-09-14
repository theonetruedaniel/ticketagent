-- Local-only single-user fixture. Supabase Auth creates the profile in normal use.
insert into public.events (mlb_game_pk, away_team, opponent, starts_at, venue)
values
  ('746001', 'New York Mets', 'New York Mets', now() + interval '3 days', 'Truist Park'),
  ('746002', 'Philadelphia Phillies', 'Philadelphia Phillies', now() + interval '8 days', 'Truist Park')
on conflict (mlb_game_pk) do nothing;
