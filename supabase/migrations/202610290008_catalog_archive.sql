begin;
alter table public.masters add column archived boolean not null default false;
alter table public.services add column archived boolean not null default false;
create index appointments_master_history_idx on public.appointments(master_id);
create index appointments_service_history_idx on public.appointments(service_id);

-- Guest history must still name the master after removal from the public catalog.
alter function private.appointment_json(public.appointments) rename to appointment_json_before_archive;
create function private.appointment_json(a public.appointments) returns jsonb
language sql stable set search_path='' as $$
  select private.appointment_json_before_archive(a) || jsonb_build_object(
    'masterName',(select name from public.masters where id=a.master_id));
$$;

alter function private.master_json(public.masters) rename to master_json_before_archive;
create function private.master_json(m public.masters) returns jsonb
language sql stable set search_path='' as $$
  select private.master_json_before_archive(m) || jsonb_build_object('archived',m.archived);
$$;

-- Keep all existing availability rules, including rate-protected callers.
alter function private.slot_available(text,text,timestamptz,uuid) rename to slot_available_before_archive;
create function private.slot_available(p_service text,p_master text,p_start timestamptz,p_exclude uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.services where id=p_service and not archived)
    and exists(select 1 from public.masters where id=p_master and not archived)
    and private.slot_available_before_archive(p_service,p_master,p_start,p_exclude);
$$;

alter function public.get_public_catalog() rename to get_public_catalog_before_archive;
alter function public.get_public_catalog_before_archive() set schema private;
create function public.get_public_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
  select private.get_public_catalog_before_archive() || jsonb_build_object(
    'services',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.services s where s.active and not s.archived),'[]'),
    'masters',coalesce((select jsonb_agg(private.master_json(m) || jsonb_build_object(
      'serviceIds',coalesce((select jsonb_agg(ms.service_id order by ms.service_id) from public.master_services ms
        join public.services s on s.id=ms.service_id where ms.master_id=m.id and s.active and not s.archived),'[]'))
      order by m.name) from public.masters m where not m.archived),'[]'));
$$;
alter function public.get_admin_snapshot() rename to get_admin_snapshot_before_archive;
alter function public.get_admin_snapshot_before_archive() set schema private;
create function public.get_admin_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.assert_admin();
  return private.get_admin_snapshot_before_archive() || jsonb_build_object(
    'masters',coalesce((select jsonb_agg(private.master_json(m) order by m.name) from public.masters m),'[]'));
end;
$$;

-- Inspection is advisory for the confirmation UI; the mutation always recounts.
create function public.admin_catalog_impact(p_kind text,p_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare archived_value boolean; total_count bigint; future_count bigint;
begin
  perform private.assert_admin();
  if p_kind='master' then select archived into archived_value from public.masters where id=p_id;
  elsif p_kind='service' then select archived into archived_value from public.services where id=p_id;
  else raise exception 'INVALID_REQUEST'; end if;
  if archived_value is null then raise exception 'CATALOG_NOT_FOUND'; end if;
  select count(*),count(*) filter(where a.status <> 'cancelled' and a.end_at > now())
    into total_count,future_count from public.appointments a
    where (p_kind='master' and a.master_id=p_id) or (p_kind='service' and a.service_id=p_id);
  return jsonb_build_object('total',total_count,'future',future_count,'archived',archived_value,
    'revision',(select revision from private.system_state where id));
end;
$$;

create function public.admin_catalog_action(p_kind text,p_id text,p_action text,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare impact jsonb;
begin
  -- Same lock/order as booking and profile changes: check + mutation are atomic.
  perform private.lock_salon();
  perform pg_advisory_xact_lock(713506,1);
  perform private.assert_admin();
  if p_action is null or p_action not in ('delete','archive','restore') then raise exception 'INVALID_REQUEST'; end if;
  impact := public.admin_catalog_impact(p_kind,p_id);
  if p_action <> 'restore' and (impact->>'future')::bigint > 0 then
    raise exception 'CATALOG_FUTURE_BOOKINGS' using detail=impact->>'future';
  end if;
  if p_expected_revision is distinct from (impact->>'revision')::bigint then raise exception 'DATA_CHANGED'; end if;
  if p_action='delete' then
    -- Includes cancelled visits: their history/access/notifications must survive.
    if (impact->>'total')::bigint > 0 then raise exception 'CATALOG_HAS_HISTORY'; end if;
    if p_kind='master' then
      delete from public.masters where id=p_id; -- cascades only services bindings/time blocks
    else
      delete from public.master_services where service_id=p_id;
      delete from public.services where id=p_id;
    end if;
  elsif p_kind='master' then
    update public.masters set archived=(p_action='archive') where id=p_id;
  else
    update public.services set archived=(p_action='archive') where id=p_id;
  end if;
  -- Never remove Storage files here. Existing GC protects all surviving references,
  -- including archived masters, and reclaims only unreferenced old assets.
  perform private.bump_revision();
  return public.get_admin_snapshot();
end;
$$;

revoke all on function private.master_json(public.masters),private.master_json_before_archive(public.masters),
  private.appointment_json(public.appointments),private.appointment_json_before_archive(public.appointments),
  private.slot_available(text,text,timestamptz,uuid),private.slot_available_before_archive(text,text,timestamptz,uuid),
  private.get_public_catalog_before_archive(),private.get_admin_snapshot_before_archive() from public,anon,authenticated,service_role;
revoke all on function public.get_public_catalog(),public.get_admin_snapshot(),public.admin_catalog_impact(text,text),
  public.admin_catalog_action(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_public_catalog() to anon,authenticated;
grant execute on function public.get_admin_snapshot(),public.admin_catalog_impact(text,text),
  public.admin_catalog_action(text,text,text,bigint) to authenticated;
commit;
