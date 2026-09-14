create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.schedule_braves_cron()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    select count(distinct name) < 2
    from vault.decrypted_secrets
    where name in ('app_url', 'cron_secret')
  ) then
    return false;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'braves-collector-every-five-minutes',
    'braves-alert-delivery-every-minute'
  );

  perform cron.schedule(
    'braves-collector-every-five-minutes',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/internal/collect',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb
      );
    $job$
  );

  perform cron.schedule(
    'braves-alert-delivery-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/internal/deliver-alerts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb
      );
    $job$
  );

  return true;
end;
$function$;

revoke all on function private.schedule_braves_cron() from public;

do $block$
begin
  if private.schedule_braves_cron() then
    raise notice 'Braves collector and alert jobs scheduled.';
  else
    raise notice 'Cron jobs not scheduled: add app_url and cron_secret to Vault, then run select private.schedule_braves_cron();';
  end if;
end;
$block$;
