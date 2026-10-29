-- Additive protection upgrade. No appointments/catalog/Auth users are deleted or reseeded.
begin;
grant usage on schema public to service_role;
-- Keep the existing transactional business rules, but remove their public entry points.
alter function public.create_appointment(uuid,text,jsonb) set schema private;
alter function public.reschedule_appointment(uuid,text,uuid,integer,jsonb) set schema private;
alter function public.cancel_appointment(uuid,text,uuid,integer) set schema private;
alter function public.get_appointment(uuid,text) set schema private;
alter function public.get_available_slots(text,text,date,uuid,text) set schema private;
alter function public.get_next_available_slot(text,text,date,uuid,text) set schema private;

-- The moved implementation must call the private slot reader, not the new admin wrapper.
create or replace function private.get_next_available_slot(p_service_id text, p_master_id text default 'any', p_from date default null, p_exclude_id uuid default null, p_manage_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d date := greatest(coalesce(p_from,(now() at time zone 'Asia/Bishkek')::date),(now() at time zone 'Asia/Bishkek')::date); slots jsonb;
begin
  if p_exclude_id is not null then perform private.assert_access(p_exclude_id,p_manage_token); end if;
  while d <= (now() at time zone 'Asia/Bishkek')::date + 60 loop
    slots := private.get_available_slots(p_service_id,p_master_id,d,p_exclude_id,p_manage_token);
    if jsonb_array_length(slots) > 0 then return (slots->0) || jsonb_build_object('date',d); end if;
    d := d + 1;
  end loop;
  return null;
end;
$$;

-- Admin clients retain their RPC signatures. An Auth account alone is insufficient.
create function public.create_appointment(p_request_id uuid,p_manage_token text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.create_appointment(p_request_id,p_manage_token,p_payload); end;
$$;
create function public.reschedule_appointment(p_id uuid,p_manage_token text,p_request_id uuid,p_expected_version integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.reschedule_appointment(p_id,p_manage_token,p_request_id,p_expected_version,p_payload); end;
$$;
create function public.cancel_appointment(p_id uuid,p_manage_token text,p_request_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.cancel_appointment(p_id,p_manage_token,p_request_id,p_expected_version); end;
$$;
create function public.get_appointment(p_id uuid,p_manage_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.get_appointment(p_id,p_manage_token); end;
$$;
create function public.get_available_slots(p_service_id text,p_master_id text,p_date date,p_exclude_id uuid default null,p_manage_token text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.get_available_slots(p_service_id,p_master_id,p_date,p_exclude_id,p_manage_token); end;
$$;
create function public.get_next_available_slot(p_service_id text,p_master_id text default 'any',p_from date default null,p_exclude_id uuid default null,p_manage_token text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform private.assert_admin(); return private.get_next_available_slot(p_service_id,p_master_id,p_from,p_exclude_id,p_manage_token); end;
$$;

create table private.booking_rate_buckets (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null check(hits > 0),
  expires_at timestamptz not null,
  primary key(bucket,window_start)
);
create index booking_rate_expiry on private.booking_rate_buckets(expires_at);
alter table private.booking_rate_buckets enable row level security;
revoke all on private.booking_rate_buckets from public,anon,authenticated,service_role;

-- Atomic upsert; a rejected attempt never increases a saturated bucket.
create function private.take_booking_quota(p_bucket text,p_seconds integer,p_limit integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare start_time timestamptz; counter integer; clock_time timestamptz := clock_timestamp();
begin
  start_time := to_timestamp(floor(extract(epoch from clock_time)/p_seconds)*p_seconds);
  insert into private.booking_rate_buckets(bucket,window_start,hits,expires_at)
  values(p_bucket,start_time,1,start_time+make_interval(secs=>p_seconds))
  on conflict(bucket,window_start) do update set hits=private.booking_rate_buckets.hits+1
    where private.booking_rate_buckets.hits < p_limit
  returning hits into counter;
  if counter is null then return greatest(1,ceil(extract(epoch from start_time+make_interval(secs=>p_seconds)-clock_time))::integer); end if;
  return 0;
end;
$$;

-- Called in a SEPARATE transaction before Siteverify/operation. Failures still consume quotas.
-- No caller-supplied IP, user id, JWT role, or arbitrary bucket key is accepted.
create function public.booking_gateway_limit(p_operation text,p_target uuid default null,p_phone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare wait_seconds integer; quota integer; subject text;
begin
  if p_operation not in ('create','read','move','cancel','slots','next') or p_operation is null then raise exception 'INVALID_OPERATION'; end if;
  perform pg_advisory_xact_lock(713505,1);
  -- Bounded by global request budgets; expired counters are removed on incoming traffic.
  delete from private.booking_rate_buckets where expires_at < clock_timestamp();
  wait_seconds := private.take_booking_quota('all:minute',60,600);
  if wait_seconds > 0 then return jsonb_build_object('allowed',false,'retryAfter',wait_seconds); end if;
  quota := case p_operation when 'create' then 30 when 'read' then 300 when 'move' then 60 when 'cancel' then 60 else 300 end;
  wait_seconds := private.take_booking_quota(p_operation||':minute',60,quota);
  if wait_seconds > 0 then return jsonb_build_object('allowed',false,'retryAfter',wait_seconds); end if;
  if p_operation = 'create' then
    wait_seconds := private.take_booking_quota('create:hour',3600,100);
    if wait_seconds = 0 and p_phone ~ '^\+996[0-9]{9}$' then
      subject := private.hash_value(p_phone);
      wait_seconds := private.take_booking_quota('phone:hour:'||subject,3600,3);
      if wait_seconds = 0 then wait_seconds := private.take_booking_quota('phone:day:'||subject,86400,10); end if;
    end if;
  elsif p_target is not null and p_operation in ('read','move','cancel') then
    -- Same target bucket regardless of supplied management code, so guessing cannot rotate it.
    subject := private.hash_value(p_target::text);
    wait_seconds := private.take_booking_quota(p_operation||':target:minute:'||subject,60,case when p_operation='read' then 30 else 6 end);
    if wait_seconds = 0 then
      wait_seconds := private.take_booking_quota(p_operation||':target:hour:'||subject,3600,case when p_operation='read' then 180 else 20 end);
    end if;
  end if;
  return jsonb_build_object('allowed',wait_seconds=0,'retryAfter',wait_seconds);
end;
$$;

-- Only the deployed server may use this entry point, AFTER quota + CAPTCHA checks.
-- Force guest identity even if a privileged transport happens to carry user claims.
create function public.booking_gateway_execute(p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  case p_operation
    when 'create' then return private.create_appointment((p_args->>'p_request_id')::uuid,p_args->>'p_manage_token',p_args->'p_payload');
    when 'read' then return private.get_appointment((p_args->>'p_id')::uuid,p_args->>'p_manage_token');
    when 'move' then return private.reschedule_appointment((p_args->>'p_id')::uuid,p_args->>'p_manage_token',(p_args->>'p_request_id')::uuid,(p_args->>'p_expected_version')::integer,p_args->'p_payload');
    when 'cancel' then return private.cancel_appointment((p_args->>'p_id')::uuid,p_args->>'p_manage_token',(p_args->>'p_request_id')::uuid,(p_args->>'p_expected_version')::integer);
    when 'slots' then return private.get_available_slots(p_args->>'p_service_id',p_args->>'p_master_id',(p_args->>'p_date')::date,(p_args->>'p_exclude_id')::uuid,p_args->>'p_manage_token');
    when 'next' then return private.get_next_available_slot(p_args->>'p_service_id',coalesce(p_args->>'p_master_id','any'),(p_args->>'p_from')::date,(p_args->>'p_exclude_id')::uuid,p_args->>'p_manage_token');
    else raise exception 'INVALID_OPERATION';
  end case;
end;
$$;
revoke all on schema private from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
revoke all on function public.create_appointment(uuid,text,jsonb), public.reschedule_appointment(uuid,text,uuid,integer,jsonb), public.cancel_appointment(uuid,text,uuid,integer), public.get_appointment(uuid,text), public.get_available_slots(text,text,date,uuid,text), public.get_next_available_slot(text,text,date,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_appointment(uuid,text,jsonb), public.reschedule_appointment(uuid,text,uuid,integer,jsonb), public.cancel_appointment(uuid,text,uuid,integer), public.get_appointment(uuid,text), public.get_available_slots(text,text,date,uuid,text), public.get_next_available_slot(text,text,date,uuid,text) to authenticated;
revoke all on function public.booking_gateway_limit(text,uuid,text), public.booking_gateway_execute(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.booking_gateway_limit(text,uuid,text), public.booking_gateway_execute(text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

