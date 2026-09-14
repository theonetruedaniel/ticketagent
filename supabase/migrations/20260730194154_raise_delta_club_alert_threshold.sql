create or replace function public.enforce_email_outbox_safety()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  listing jsonb := new.payload -> 'listing';
  section_label text := coalesce(listing ->> 'section', '');
  section_match text[];
  section_number integer;
  price_per_ticket numeric;
  quantity_min integer;
  is_all_in boolean;
  is_limited_view boolean;
  is_priority_alert boolean;
  is_infield_alert boolean;
  is_xfinity boolean;
  is_delta boolean;
  is_club boolean;
  eligible boolean := false;
begin
  if not exists (
    select 1
    from public.profiles
    where id = new.owner_id
      and alerts_enabled is true
  ) then
    return null;
  end if;

  section_match := regexp_match(
    section_label,
    '(^|[^0-9])([0-9]{3})([^0-9]|$)'
  );
  if section_match is null then
    return null;
  end if;

  section_number := section_match[2]::integer;
  if not (
    section_number between 116 and 135
    or section_number between 216 and 235
  ) then
    return null;
  end if;

  is_priority_alert :=
    new.payload ->> 'priority' = 'true'
    or new.payload ->> 'type' = 'priorityClub';
  is_infield_alert :=
    new.payload ->> 'infieldDeal' = 'true'
    or new.payload ->> 'type' = 'infieldDeal';

  if is_priority_alert or is_infield_alert then
    price_per_ticket := nullif(listing ->> 'pricePerTicket', '')::numeric;
    quantity_min := nullif(listing ->> 'quantityMin', '')::integer;
    is_all_in := listing ->> 'allIn' = 'true';
    is_limited_view := listing ->> 'limitedView' = 'true';
    is_xfinity := lower(section_label) like '%xfinity%';
    is_delta := lower(section_label) like '%delta%';
    is_club := lower(section_label) like '%club%';

    if
      price_per_ticket is null
      or quantity_min is null
      or quantity_min > 2
      or not is_all_in
      or coalesce(listing ->> 'currency', '') <> 'USD'
    then
      return null;
    end if;

    if is_priority_alert then
      eligible :=
        is_club
        and (
          (
            section_number between 122 and 130
            and is_delta
            and price_per_ticket <= 100
          )
          or
          (
            section_number between 216 and 235
            and is_xfinity
            and price_per_ticket <= 60
          )
        );
    else
      eligible :=
        not is_limited_view
        and (
          (
            section_number between 116 and 135
            and price_per_ticket <= case
              when is_delta and section_number between 122 and 130 then 100
              else 60
            end
          )
          or
          (
            section_number between 216 and 235
            and price_per_ticket <= case when is_xfinity then 60 else 40 end
          )
        );
    end if;

    if not eligible then
      return null;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  if (
    select count(*)
    from public.email_outbox
    where owner_id = new.owner_id
      and status in ('pending', 'sent')
      and created_at >= now() - interval '1 hour'
  ) >= 5 then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_email_outbox_safety() from public;
