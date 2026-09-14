do $block$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Generated authentication secret for Braves Ticket Scanner cron requests'
    );
  end if;
end;
$block$;

create or replace function public.verify_cron_secret(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select extensions.digest(decrypted_secret, 'sha256')
        = extensions.digest(candidate, 'sha256')
      from vault.decrypted_secrets
      where name = 'cron_secret'
      limit 1
    ),
    false
  );
$function$;

revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

comment on function public.verify_cron_secret(text) is
  'Verifies Vault-managed cron bearer tokens. Callable only through the service role.';
