begin;
-- No profile is assumed real based on its name, photo or past bookings.
alter table public.masters add column published boolean not null default false;
alter table public.salon_settings
  add column building_description text not null default '' check(length(building_description)<=500),
  add column map_url text not null default '' check(length(map_url)<=2000 and (map_url='' or map_url ~ '^https://(yandex[.](ru|com)/maps/|2gis[.](kg|ru)/|go[.]2gis[.]com/|www[.]google[.]com/maps/|maps[.]google[.]com/|maps[.]app[.]goo[.]gl/)[^[:space:]]*$')),
  add column map_embed_url text not null default '' check(length(map_embed_url)<=2000 and (map_embed_url='' or map_embed_url ~ '^https://(yandex[.](ru|com)/map-widget/v1/|api-maps[.]yandex[.]ru/frame/v1/|www[.]google[.]com/maps/embed[?/])[^[:space:]]*$')),
  add column map_confirmed boolean not null default false;
-- Only fill missing settings; preserve any address already entered by the owner.
update public.salon_settings set address='Бишкек, Проспект Манаса, 38 / Киевская улица, 164',
  building_description='Малоэтажный жилой дом' where id and btrim(address)='';
-- Owner supplied this building link on 2026-10-30. The widget uses exactly
-- its coordinates, with no invented entrance, floor or business listing.
update public.salon_settings set
  map_url='https://2gis.kg/bishkek/geo/15763234351108741/74.587887,42.875068',
  map_embed_url='https://yandex.ru/map-widget/v1/?ll=74.587887%2C42.875068&z=17&pt=74.587887%2C42.875068%2Cpm2rdm',
  map_confirmed=true
where id and address='Бишкек, Проспект Манаса, 38 / Киевская улица, 164';

alter function private.master_json(public.masters) rename to master_json_before_publication;
create function private.master_json(m public.masters) returns jsonb
language sql stable set search_path='' as $$
  select private.master_json_before_publication(m) || jsonb_build_object('published',m.published);
$$;
alter function private.settings_json() rename to settings_json_before_location;
create function private.settings_json() returns jsonb
language sql stable security definer set search_path='' as $$
  select private.settings_json_before_location() || jsonb_build_object('buildingDescription',building_description,
    'mapUrl',map_url,'mapEmbedUrl',map_embed_url,'mapConfirmed',map_confirmed) from public.salon_settings where id;
$$;

alter function private.slot_available(text,text,timestamptz,uuid) rename to slot_available_before_publication;
create function private.slot_available(p_service text,p_master text,p_start timestamptz,p_exclude uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.masters where id=p_master and published and not archived)
    and private.slot_available_before_publication(p_service,p_master,p_start,p_exclude);
$$;
-- The administrative snapshot continues to include every profile and its history.
create or replace function public.get_public_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
  select private.get_public_catalog_before_archive() || jsonb_build_object(
    'services',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.services s where s.active and not s.archived),'[]'),
    'masters',coalesce((select jsonb_agg(private.master_json(m) || jsonb_build_object(
      'serviceIds',coalesce((select jsonb_agg(ms.service_id order by ms.service_id) from public.master_services ms
        join public.services s on s.id=ms.service_id where ms.master_id=m.id and s.active and not s.archived),'[]'))
      order by m.name) from public.masters m where m.published and not m.archived),'[]'));
$$;

-- Seed portfolio images use legacy_src. Only files uploaded by administrators
-- and explicitly made visible may appear as salon work. Originals stay in admin.
create or replace function private.site_content_json(p_admin boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('revision',(select revision from private.site_content_state where id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'assetId',i.asset_id,
      'legacySrc',i.legacy_src,'alt',i.alt,'caption',i.caption,'category',i.category,
      'position',i.position,'visible',i.visible) order by i.kind,i.position,i.id)
      from private.site_images i where p_admin or (i.visible and (i.kind<>'portfolio' or i.asset_id is not null))),'[]'::jsonb));
$$;

alter function public.admin_apply_changes(jsonb,bigint,boolean) rename to admin_apply_before_publication;
alter function public.admin_apply_before_publication(jsonb,bigint,boolean) set schema private;
create function public.admin_apply_changes(p_changes jsonb,p_expected_revision bigint,p_allow_conflicts boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  perform private.lock_salon();
  perform private.assert_admin();
  for v in select * from jsonb_array_elements(coalesce(p_changes->'masters','[]')) loop
    if v ? 'published' and jsonb_typeof(v->'published') is distinct from 'boolean' then raise exception 'INVALID_CHANGES'; end if;
  end loop;
  v := p_changes->'settings';
  if v ? 'mapConfirmed' and jsonb_typeof(v->'mapConfirmed') is distinct from 'boolean' then raise exception 'INVALID_CHANGES'; end if;
  -- Retain existing schedule, booking protection, image CAS and revision checks.
  perform private.admin_apply_before_publication(p_changes,p_expected_revision,p_allow_conflicts);
  for v in select * from jsonb_array_elements(coalesce(p_changes->'masters','[]')) loop
    if v ? 'published' then update public.masters set published=(v->>'published')::boolean where id=v->>'id'; end if;
  end loop;
  if p_changes ? 'settings' then
    v := p_changes->'settings';
    update public.salon_settings set
      building_description=case when v ? 'buildingDescription' then btrim(coalesce(v->>'buildingDescription','')) else building_description end,
      map_url=case when v ? 'mapUrl' then btrim(coalesce(v->>'mapUrl','')) else map_url end,
      map_embed_url=case when v ? 'mapEmbedUrl' then btrim(coalesce(v->>'mapEmbedUrl','')) else map_embed_url end,
      map_confirmed=case when v ? 'mapConfirmed' then (v->>'mapConfirmed')::boolean else map_confirmed end where id;
  end if;
  return public.get_admin_snapshot();
end;
$$;
revoke all on function private.master_json(public.masters),private.master_json_before_publication(public.masters),
  private.settings_json(),private.settings_json_before_location(),private.slot_available(text,text,timestamptz,uuid),
  private.slot_available_before_publication(text,text,timestamptz,uuid),private.admin_apply_before_publication(jsonb,bigint,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_apply_changes(jsonb,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_apply_changes(jsonb,bigint,boolean) to authenticated;
select private.bump_revision();
update private.site_content_state set revision=revision+1 where id;
commit;
