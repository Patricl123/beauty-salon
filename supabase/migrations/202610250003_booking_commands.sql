begin;
-- Advisory lock serializes salon mutations (including block/schedule edits).
-- The EXCLUDE constraint independently enforces overlap safety for ALL SQL writers.
create function private.lock_salon() returns void language sql volatile set search_path = '' as $$
select pg_advisory_xact_lock(713504,1);
$$;
create function private.bump_revision() returns void language sql volatile security definer set search_path = '' as $$
update private.system_state set revision = revision + 1 where id;
$$;
create function private.replay_request(p_actor text, p_request uuid, p_operation text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r private.idempotency_requests;
begin
if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
select * into r from private.idempotency_requests where actor = p_actor and request_id = p_request;
if not found then return null; end if;
if r.operation <> p_operation or r.payload_hash <> private.hash_value(p_payload::text) then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
return r.appointment_id;
end;
$$;
create function private.remember_request(p_actor text, p_request uuid, p_operation text, p_payload jsonb, p_id uuid) returns void
language sql security definer set search_path = '' as $$
insert into private.idempotency_requests(actor,request_id,operation,payload_hash,appointment_id)
values(p_actor,p_request,p_operation,private.hash_value(p_payload::text),p_id);
$$;
create function private.render_message(p_template text, a public.appointments) returns text
language sql stable security definer set search_path = '' as $$
select replace(replace(replace(replace(replace(replace(replace(coalesce(p_template,''),'{name}',a.client_name),'{number}',a.id::text),'{service}',a.service_name),'{date}',to_char(a.start_at at time zone 'Asia/Bishkek','DD.MM.YYYY')),'{time}',to_char(a.start_at at time zone 'Asia/Bishkek','HH24:MI')),'{master}',coalesce((select name from public.masters where id = a.master_id),'')),'{salon}',(select name from public.salon_settings where id));
$$;
create function private.log_event(a public.appointments, p_event text, p_reminders boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare config jsonb; channel text; recipient text; recipients text[]; hours integer; ev text; target timestamptz;
begin
select settings into config from public.notification_settings where id;
delete from public.notification_events where appointment_id = a.id and planned;
recipients := array['Клиент: ' || a.client_name || ' · ' || a.phone];
if p_event in ('created','cancelled') then recipients := array_append(recipients,'Администратор'); end if;
if p_event in ('created','rescheduled','cancelled') then recipients := array_append(recipients,'Мастер: ' || (select name from public.masters where id = a.master_id)); end if;
for channel in select jsonb_array_elements_text(config->'channels') loop
  if p_event <> 'refresh_reminders' then
    foreach recipient in array recipients loop
      insert into public.notification_events(appointment_id,event,recipient,channel,message,planned_at)
      values(a.id,p_event,recipient,channel,private.render_message(config->'templates'->>p_event,a),now());
    end loop;
  end if;
  if p_reminders and a.status in ('pending','confirmed') then
    foreach hours in array array[24,2] loop
      ev := 'reminder' || hours;
      target := a.start_at - hours * interval '1 hour';
      if coalesce((config->>ev)::boolean,false) and target > now() then
        insert into public.notification_events(appointment_id,event,recipient,channel,message,planned_at,planned)
        values(a.id,ev,recipients[1],channel,private.render_message(config->'templates'->>ev,a),target,true);
      end if;
    end loop;
  end if;
end loop;
end;
$$;
create function private.check_booking_payload(p jsonb) returns timestamptz
language plpgsql set search_path = '' as $$
declare start_at timestamptz;
begin
if jsonb_typeof(p) <> 'object' or length(p::text) > 10000 then raise exception 'INVALID_BOOKING'; end if;
if coalesce(length(btrim(p->>'clientName')),0) not between 2 and 80 or coalesce(p->>'phone','') !~ '^\+996[0-9]{9}$' or length(coalesce(p->>'comment','')) > 500 then raise exception 'INVALID_CONTACTS'; end if;
if p->'consent' is distinct from 'true'::jsonb then raise exception 'CONSENT_REQUIRED'; end if;
if coalesce(p->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p->>'time','') !~ '^([01][0-9]|2[0-3]):(00|30)$' then raise exception 'INVALID_TIME'; end if;
start_at := ((p->>'date')::date + (p->>'time')::time) at time zone 'Asia/Bishkek';
if start_at <= now() or (start_at at time zone 'Asia/Bishkek')::date > (now() at time zone 'Asia/Bishkek')::date + 60 then raise exception 'TIME_OUT_OF_RANGE'; end if;
return start_at;
end;
$$;

create function public.create_appointment(p_request_id uuid, p_manage_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor text; replay uuid; a public.appointments; s public.services; start_at timestamptz;
begin
perform private.lock_salon();
actor := private.actor_key(p_manage_token);
replay := private.replay_request(actor,p_request_id,'create',p_payload);
if replay is not null then select * into a from public.appointments where id = replay; return private.appointment_json(a); end if;
start_at := private.check_booking_payload(p_payload);
select * into s from public.services where id = p_payload->>'serviceId' and active;
if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
if p_payload->>'owner' = 'salon' then perform private.assert_admin(); end if;
if (p_payload->>'expectedPrice')::integer is distinct from s.price or (p_payload->>'expectedDuration')::integer is distinct from s.duration then raise exception 'QUOTE_CHANGED'; end if;
if not private.slot_available(s.id,p_payload->>'masterId',start_at) then raise exception 'SLOT_UNAVAILABLE' using errcode = '23P01'; end if;
insert into public.appointments(service_id,master_id,start_at,end_at,duration,price,service_name,client_name,phone,comment,owner)
values(s.id,p_payload->>'masterId',start_at,start_at + s.duration * interval '1 minute',s.duration,s.price,s.name,btrim(p_payload->>'clientName'),p_payload->>'phone',coalesce(p_payload->>'comment',''),case when public.is_admin() and p_payload->>'owner' = 'salon' then 'salon' else 'visitor' end)
returning * into a;
if p_manage_token is not null then
  if p_manage_token !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_MANAGEMENT_TOKEN'; end if;
  insert into private.appointment_access values(a.id,private.hash_value(p_manage_token));
end if;
perform private.remember_request(actor,p_request_id,'create',p_payload,a.id);
perform private.log_event(a,'created');
perform private.bump_revision();
return private.appointment_json(a);
end;
$$;
create function public.reschedule_appointment(p_id uuid, p_manage_token text, p_request_id uuid, p_expected_version integer, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor text; replay uuid; a public.appointments; s public.services; new_start timestamptz; fingerprint jsonb;
begin
perform private.lock_salon();
perform private.assert_access(p_id,p_manage_token);
actor := private.actor_key(p_manage_token);
fingerprint := jsonb_build_object('id',p_id,'version',p_expected_version,'payload',p_payload);
replay := private.replay_request(actor,p_request_id,'reschedule',fingerprint);
if replay is not null then select * into a from public.appointments where id = replay; return private.appointment_json(a); end if;
select * into a from public.appointments where id = p_id for update;
if not found then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN'; end if;
if a.version is distinct from p_expected_version then raise exception 'BOOKING_CHANGED'; end if;
if a.status not in ('pending','confirmed') or a.start_at <= now() then raise exception 'BOOKING_NOT_EDITABLE'; end if;
new_start := private.check_booking_payload(p_payload);
select * into s from public.services where id = p_payload->>'serviceId' and active;
if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
if (p_payload->>'expectedPrice')::integer is distinct from s.price or (p_payload->>'expectedDuration')::integer is distinct from s.duration then raise exception 'QUOTE_CHANGED'; end if;
if not private.slot_available(s.id,p_payload->>'masterId',new_start,p_id) then raise exception 'SLOT_UNAVAILABLE' using errcode = '23P01'; end if;
update public.appointments set service_id = s.id, master_id = p_payload->>'masterId', start_at = new_start,
  end_at = new_start + s.duration * interval '1 minute', duration = s.duration, price = s.price, service_name = s.name,
  client_name = btrim(p_payload->>'clientName'), phone = p_payload->>'phone', comment = coalesce(p_payload->>'comment',''),
  version = version + 1, updated_at = now()
where id = p_id returning * into a;
perform private.remember_request(actor,p_request_id,'reschedule',fingerprint,a.id);
perform private.log_event(a,'rescheduled');
perform private.bump_revision();
return private.appointment_json(a);
end;
$$;
create function public.cancel_appointment(p_id uuid, p_manage_token text, p_request_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor text; replay uuid; a public.appointments; fingerprint jsonb;
begin
perform private.lock_salon();
perform private.assert_access(p_id,p_manage_token);
actor := private.actor_key(p_manage_token);
fingerprint := jsonb_build_object('id',p_id,'version',p_expected_version);
replay := private.replay_request(actor,p_request_id,'cancel',fingerprint);
if replay is not null then select * into a from public.appointments where id = replay; return private.appointment_json(a); end if;
select * into a from public.appointments where id = p_id for update;
if not found then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN'; end if;
if a.status = 'cancelled' then
  perform private.remember_request(actor,p_request_id,'cancel',fingerprint,a.id);
  return private.appointment_json(a);
end if;
if a.version is distinct from p_expected_version then raise exception 'BOOKING_CHANGED'; end if;
if not public.is_admin() and (a.status not in ('pending','confirmed') or a.start_at <= now()) then raise exception 'BOOKING_NOT_EDITABLE'; end if;
if a.status in ('completed','noshow') then raise exception 'BOOKING_NOT_EDITABLE'; end if;
update public.appointments set status = 'cancelled',version = version + 1,updated_at = now() where id = p_id returning * into a;
perform private.remember_request(actor,p_request_id,'cancel',fingerprint,a.id);
perform private.log_event(a,'cancelled',false);
perform private.bump_revision();
return private.appointment_json(a);
end;
$$;
create function public.admin_set_status(p_id uuid,p_status text,p_request_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; replay uuid; fingerprint jsonb; actor text;
begin
perform private.assert_admin();
if p_status = 'cancelled' then return public.cancel_appointment(p_id,null,p_request_id,p_expected_version); end if;
perform private.lock_salon();
actor := private.actor_key(null);
fingerprint := jsonb_build_object('id',p_id,'status',p_status,'version',p_expected_version);
replay := private.replay_request(actor,p_request_id,'status',fingerprint);
if replay is not null then select * into a from public.appointments where id = replay; return private.appointment_json(a); end if;
select * into a from public.appointments where id = p_id for update;
if not found then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN'; end if;
if a.version is distinct from p_expected_version then raise exception 'BOOKING_CHANGED'; end if;
if p_status not in ('pending','confirmed','arrived','completed','noshow') then raise exception 'INVALID_STATUS'; end if;
if a.status in ('cancelled','noshow') and p_status not in ('noshow') then
  if not private.slot_available(a.service_id,a.master_id,a.start_at,a.id) or not private.schedule_fits(a.master_id,a.start_at,a.duration) then raise exception 'SLOT_UNAVAILABLE' using errcode = '23P01'; end if;
end if;
update public.appointments set status=p_status,version=version+1,updated_at=now() where id=p_id returning * into a;
perform private.remember_request(actor,p_request_id,'status',fingerprint,a.id);
if p_status='confirmed' then perform private.log_event(a,'confirmed');
else perform private.log_event(a,'refresh_reminders'); end if;
perform private.bump_revision();
return private.appointment_json(a);
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.create_appointment(uuid,text,jsonb), public.reschedule_appointment(uuid,text,uuid,integer,jsonb), public.cancel_appointment(uuid,text,uuid,integer), public.admin_set_status(uuid,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.create_appointment(uuid,text,jsonb), public.reschedule_appointment(uuid,text,uuid,integer,jsonb), public.cancel_appointment(uuid,text,uuid,integer) to anon, authenticated;
grant execute on function public.admin_set_status(uuid,text,uuid,integer) to authenticated;
commit;
