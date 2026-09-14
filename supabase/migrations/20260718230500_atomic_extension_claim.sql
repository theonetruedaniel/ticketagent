create or replace function public.claim_extension_code(
  p_code_hash text,
  p_token_hash text,
  p_device_name text
)
returns table(owner_id uuid, token_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
  connection_owner uuid;
  issued_token_id uuid;
begin
  select code.id, code.owner_id
    into connection_id, connection_owner
  from public.extension_connection_codes code
  where code.code_hash = p_code_hash
    and code.claimed_at is null
    and code.expires_at > now()
  for update;

  if connection_id is null then
    return;
  end if;

  insert into public.extension_tokens (owner_id, token_hash, device_name)
  values (connection_owner, p_token_hash, left(p_device_name, 120))
  returning id into issued_token_id;

  update public.extension_connection_codes
  set claimed_at = now()
  where id = connection_id;

  return query select connection_owner, issued_token_id;
end;
$$;

revoke execute on function public.claim_extension_code(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_extension_code(text, text, text)
  to service_role;
