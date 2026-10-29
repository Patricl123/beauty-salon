begin;
create function public.admin_apply_changes(p_changes jsonb, p_expected_revision bigint, p_allow_conflicts boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; settings_value jsonb; key_value text; channels jsonb; a public.appointments; conflict_count integer; channel text;
begin
  perform private.assert_admin();
  perform private.lock_salon();
  if p_expected_revision is distinct from (select revision from private.system_state where id) then raise exception 'DATA_CHANGED'; end if;
  if jsonb_typeof(p_changes) <> 'object' or length(p_changes::text) > 200000 or p_changes - array['services','masters','settings','notes','blocksUpsert','blocksDelete','contacts','notificationSettings'] <> '{}'::jsonb then raise exception 'INVALID_CHANGES'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_changes->'services','[]')) loop
    insert into public.services(id,category,name,description,price,duration,active)
    values(v->>'id',v->>'category',btrim(v->>'name'),coalesce(v->>'description',''),(v->>'price')::integer,(v->>'duration')::integer,(v->>'active')::boolean)
    on conflict(id) do update set category=excluded.category,name=excluded.name,description=excluded.description,price=excluded.price,duration=excluded.duration,active=excluded.active;
  end loop;
  for v in select * from jsonb_array_elements(coalesce(p_changes->'masters','[]')) loop
    insert into public.masters(id,name,specialty,photo,days,start_time,end_time,break_start,break_end,days_off,vacation_start,vacation_end)
    values(v->>'id',btrim(v->>'name'),coalesce(v->>'specialty',''),coalesce(v->>'photo',''),array(select jsonb_array_elements_text(v->'days')::integer),
      (v->>'start')::time,(v->>'end')::time,nullif(v->>'breakStart','')::time,nullif(v->>'breakEnd','')::time,
      array(select jsonb_array_elements_text(v->'daysOff')::date),nullif(v->>'vacationStart','')::date,nullif(v->>'vacationEnd','')::date)
    on conflict(id) do update set name=excluded.name,specialty=excluded.specialty,photo=excluded.photo,days=excluded.days,start_time=excluded.start_time,end_time=excluded.end_time,
      break_start=excluded.break_start,break_end=excluded.break_end,days_off=excluded.days_off,vacation_start=excluded.vacation_start,vacation_end=excluded.vacation_end;
    delete from public.master_services where master_id=v->>'id';
    insert into public.master_services(master_id,service_id) select v->>'id',jsonb_array_elements_text(v->'serviceIds');
  end loop;
  if p_changes ? 'settings' then
    v := p_changes->'settings';
    update public.salon_settings set name=btrim(v->>'name'),tagline=v->>'tagline',address=v->>'address',
      phone=regexp_replace(v->>'phone','[[:space:]()-]','','g'),email=v->>'email',start_time=(v->>'start')::time,end_time=(v->>'end')::time,
      days=array(select jsonb_array_elements_text(v->'days')::integer),cancellation_policy=v->>'cancellationPolicy' where id;
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_changes->'blocksUpsert','[]')) loop
    insert into public.time_blocks(id,master_id,start_at,end_at,reason)
    values(v->>'id',v->>'masterId',((v->>'date')::date+(v->>'start')::time) at time zone 'Asia/Bishkek',((v->>'date')::date+(v->>'end')::time) at time zone 'Asia/Bishkek',coalesce(v->>'reason',''))
    on conflict(id) do update set master_id=excluded.master_id,start_at=excluded.start_at,end_at=excluded.end_at,reason=excluded.reason;
  end loop;
  delete from public.time_blocks where id in (select jsonb_array_elements_text(coalesce(p_changes->'blocksDelete','[]')));
  if p_changes ? 'masters' or p_changes ? 'settings' or p_changes ? 'blocksUpsert' then
    select count(*) into conflict_count from public.appointments ap where ap.status not in ('cancelled','noshow','completed') and ap.start_at > now() and not private.schedule_fits(ap.master_id,ap.start_at,ap.duration);
    if conflict_count > 0 and p_allow_conflicts is distinct from true then raise exception 'SCHEDULE_CONFLICT' using detail = conflict_count::text; end if;
  end if;
  for key_value,v in select key,value from jsonb_each(coalesce(p_changes->'notes','{}')) loop
    insert into public.client_notes(phone,note) values(key_value,v#>>'{}')
    on conflict(phone) do update set note=excluded.note,updated_at=now();
  end loop;
  for v in select * from jsonb_array_elements(coalesce(p_changes->'contacts','[]')) loop
    update public.appointments set client_name=btrim(v->>'clientName'),phone=v->>'phone',comment=coalesce(v->>'comment',''),version=version+1,updated_at=now()
    where id=(v->>'id')::uuid returning * into a;
    if not found then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN'; end if;
    perform private.log_event(a,'refresh_reminders');
  end loop;
  if p_changes ? 'notificationSettings' then
    settings_value := p_changes->'notificationSettings'; channels := settings_value->'channels';
    if jsonb_typeof(channels) <> 'array' or jsonb_typeof(settings_value->'reminder24') <> 'boolean' or jsonb_typeof(settings_value->'reminder2') <> 'boolean' or jsonb_typeof(settings_value->'templates') <> 'object' then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
    if exists(select 1 from jsonb_array_elements_text(channels) ch where ch not in ('SMS','WhatsApp','email')) then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
    foreach key_value in array array['created','confirmed','rescheduled','cancelled','reminder24','reminder2','schedule'] loop
      if jsonb_typeof(settings_value->'templates'->key_value) is distinct from 'string' or length(settings_value->'templates'->>key_value) > 2000 then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
    end loop;
    update public.notification_settings set settings=settings_value where id;
    for a in select * from public.appointments where status in ('pending','confirmed') and start_at > now() loop perform private.log_event(a,'refresh_reminders'); end loop;
  end if;
  if p_changes ? 'masters' or p_changes ? 'settings' or p_changes ? 'blocksUpsert' or p_changes ? 'blocksDelete' then
    for channel in select jsonb_array_elements_text(settings->'channels') from public.notification_settings where id loop
      insert into public.notification_events(event,recipient,channel,message,planned_at)
      select 'schedule','Мастер: ' || m.name,channel,'Рабочий график обновлён. Проверьте предстоящие записи.',now() from public.masters m;
    end loop;
  end if;
  perform private.bump_revision();
  return public.get_admin_snapshot();
end;
$$;
revoke all on function public.admin_apply_changes(jsonb,bigint,boolean) from public, anon, authenticated;
grant execute on function public.admin_apply_changes(jsonb,bigint,boolean) to authenticated;
-- There is intentionally no API for granting admin rights or deleting all real data.
commit;
