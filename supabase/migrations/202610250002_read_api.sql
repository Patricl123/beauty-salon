begin;
create function private.hash_value(value text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(value, 'UTF8')), 'hex');
$$;

create function private.assert_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
end;
$$;
create function private.assert_access(p_id uuid, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then return; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from private.appointment_access where appointment_id = p_id and token_hash = private.hash_value(p_token)
  ) then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501'; end if;
end;
$$;
create function private.actor_key(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then return 'admin:' || auth.uid()::text; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_MANAGEMENT_TOKEN'; end if;
  return 'guest:' || private.hash_value(p_token);
end;
$$;
create function private.appointment_json(a public.appointments) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'serviceId', a.service_id, 'serviceName', a.service_name,
    'masterId', a.master_id, 'date', to_char(a.start_at at time zone 'Asia/Bishkek', 'YYYY-MM-DD'),
    'time', to_char(a.start_at at time zone 'Asia/Bishkek', 'HH24:MI'),
    'duration', a.duration, 'price', a.price, 'clientName', a.client_name, 'phone', a.phone,
    'comment', a.comment, 'status', a.status, 'owner', a.owner, 'createdAt', a.created_at, 'version', a.version
  );
$$;
create function private.master_json(m public.masters) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'name', m.name, 'specialty', m.specialty, 'photo', m.photo,
    'serviceIds', coalesce((select jsonb_agg(service_id order by service_id) from public.master_services where master_id = m.id), '[]'),
    'days', m.days, 'start', to_char(m.start_time, 'HH24:MI'), 'end', to_char(m.end_time, 'HH24:MI'),
    'breakStart', coalesce(to_char(m.break_start, 'HH24:MI'), ''), 'breakEnd', coalesce(to_char(m.break_end, 'HH24:MI'), ''),
    'daysOff', m.days_off, 'vacationStart', coalesce(m.vacation_start::text, ''), 'vacationEnd', coalesce(m.vacation_end::text, '')
  );
$$;
create function private.settings_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', name, 'tagline', tagline, 'address', address, 'phone', phone, 'email', email,
    'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'), 'days', days, 'cancellationPolicy', cancellation_policy)
  from public.salon_settings where id;
$$;

create function private.schedule_fits(p_master text, p_start timestamptz, p_duration integer) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.masters; s public.salon_settings;
  local_start timestamp := p_start at time zone 'Asia/Bishkek';
  local_end timestamp := (p_start + p_duration * interval '1 minute') at time zone 'Asia/Bishkek';
begin
  select * into m from public.masters where id = p_master;
  if not found then return false; end if;
  select * into s from public.salon_settings where id;
  if p_duration is null or p_duration <= 0 or local_start::date <> local_end::date then return false; end if;
  if not (extract(dow from local_start)::integer = any(m.days)) or not (extract(dow from local_start)::integer = any(s.days)) then return false; end if;
  if local_start::date = any(m.days_off) or (m.vacation_start is not null and local_start::date between m.vacation_start and m.vacation_end) then return false; end if;
  if local_start::time < greatest(m.start_time, s.start_time) or local_end::time > least(m.end_time, s.end_time) then return false; end if;
  if m.break_start is not null and local_start::time < m.break_end and local_end::time > m.break_start then return false; end if;
  return not exists(select 1 from public.time_blocks b where b.master_id = p_master and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(p_start,p_start + p_duration * interval '1 minute','[)'));
end;
$$;
create function private.slot_available(p_service text, p_master text, p_start timestamptz, p_exclude uuid default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s public.services;
begin
  select * into s from public.services where id = p_service and active;
  if not found or p_start <= now() or (p_start at time zone 'Asia/Bishkek')::date > (now() at time zone 'Asia/Bishkek')::date + 60 then return false; end if;
  if extract(second from p_start) <> 0 or extract(minute from p_start)::integer % 30 <> 0 then return false; end if;
  if not exists(select 1 from public.master_services where master_id = p_master and service_id = p_service) or not private.schedule_fits(p_master, p_start, s.duration) then return false; end if;
  return not exists(select 1 from public.appointments a where a.master_id = p_master and a.status not in ('cancelled','noshow') and (p_exclude is null or a.id <> p_exclude) and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(p_start,p_start + s.duration * interval '1 minute','[)'));
end;
$$;

create function public.get_public_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', 1, 'revision', (select revision from private.system_state where id),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.services s where active), '[]'),
    'masters', coalesce((select jsonb_agg(private.master_json(m) order by m.name) from public.masters m), '[]'),
    'settings', private.settings_json(), 'appointments', '[]'::jsonb, 'blocks', '[]'::jsonb,
    'clientNotes', '{}'::jsonb, 'notifications', '[]'::jsonb,
    'notificationSettings', '{"channels":[],"reminder24":false,"reminder2":false,"templates":{}}'::jsonb
  );
$$;
create function public.get_admin_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return public.get_public_catalog() || jsonb_build_object(
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.services s), '[]'),
    'appointments', coalesce((select jsonb_agg(private.appointment_json(a) order by a.start_at desc) from public.appointments a), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'masterId', b.master_id,
      'date', to_char(b.start_at at time zone 'Asia/Bishkek','YYYY-MM-DD'),
      'start', to_char(b.start_at at time zone 'Asia/Bishkek','HH24:MI'),
      'end', to_char(b.end_at at time zone 'Asia/Bishkek','HH24:MI'), 'reason', b.reason)) from public.time_blocks b), '[]'),
    'clientNotes', coalesce((select jsonb_object_agg(phone,note) from public.client_notes), '{}'),
    'notificationSettings', (select settings from public.notification_settings where id),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id,'appointmentId',coalesce(n.appointment_id::text,''),'event',n.event,'recipient',n.recipient,'channel',n.channel,'text',n.message,'at',n.planned_at,'planned',n.planned) order by n.planned_at desc)
      from (select * from public.notification_events order by planned_at desc limit 1000) n), '[]')
  );
end;
$$;
create function public.get_appointment(p_id uuid, p_manage_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.assert_access(p_id, p_manage_token);
  select private.appointment_json(a) into result from public.appointments a where id = p_id;
  if result is null then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501'; end if;
  return result;
end;
$$;
create function public.get_available_slots(p_service_id text, p_master_id text, p_date date, p_exclude_id uuid default null, p_manage_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_exclude_id is not null then perform private.assert_access(p_exclude_id, p_manage_token); end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Bishkek')::date or p_date > (now() at time zone 'Asia/Bishkek')::date + 60 then return '[]'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('time',to_char(t.slot at time zone 'Asia/Bishkek','HH24:MI'),'masterId',t.master_id) order by t.slot), '[]') into result
  from (
    select distinct on (candidate.slot) candidate.slot, m.id as master_id
    from generate_series(p_date::timestamp at time zone 'Asia/Bishkek', (p_date::timestamp + interval '23 hours 30 minutes') at time zone 'Asia/Bishkek', interval '30 minutes') candidate(slot)
    cross join public.masters m
    where (p_master_id = 'any' or m.id = p_master_id) and private.slot_available(p_service_id,m.id,candidate.slot,p_exclude_id)
    order by candidate.slot, m.id
  ) t;
  return result;
end;
$$;
create function public.get_next_available_slot(p_service_id text, p_master_id text default 'any', p_from date default null, p_exclude_id uuid default null, p_manage_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d date := greatest(coalesce(p_from,(now() at time zone 'Asia/Bishkek')::date),(now() at time zone 'Asia/Bishkek')::date); slots jsonb;
begin
  if p_exclude_id is not null then perform private.assert_access(p_exclude_id,p_manage_token); end if;
  while d <= (now() at time zone 'Asia/Bishkek')::date + 60 loop
    slots := public.get_available_slots(p_service_id,p_master_id,d,p_exclude_id,p_manage_token);
    if jsonb_array_length(slots) > 0 then return (slots->0) || jsonb_build_object('date',d); end if;
    d := d + 1;
  end loop;
  return null;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.get_public_catalog(), public.get_admin_snapshot(), public.get_appointment(uuid,text), public.get_available_slots(text,text,date,uuid,text), public.get_next_available_slot(text,text,date,uuid,text) from public, anon, authenticated;
grant execute on function public.get_public_catalog(), public.get_appointment(uuid,text), public.get_available_slots(text,text,date,uuid,text), public.get_next_available_slot(text,text,date,uuid,text) to anon, authenticated;
grant execute on function public.get_admin_snapshot() to authenticated;
commit;
