begin;
-- Preserve the manually applied fix in migration history. Service-only callers
-- supply the actor from verified Auth, and revoked admins must also be rejected.
create or replace function private.assert_media_admin(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null or not exists (
    select 1 from private.admin_users where user_id=p_actor and active = true
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.assert_media_admin(uuid) from public,anon,authenticated,service_role;
commit;
