-- Additive media management. Existing bookings, catalog rows and photos are retained.
begin;

create table private.site_media_assets (
  id uuid primary key default gen_random_uuid(),
  object_path text generated always as (id::text || '.webp') stored unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending','ready','deleting')),
  width integer check (width between 1 and 2048),
  height integer check (height between 1 and 2048),
  bytes integer check (bytes between 1 and 5242880)
);
create table private.site_content_state (
  id boolean primary key default true check(id),
  revision bigint not null default 1
);
insert into private.site_content_state(id) values(true);
create table private.site_images (
  id text primary key,
  kind text not null check(kind in ('hero','salon','logo','portfolio')),
  asset_id uuid references private.site_media_assets(id),
  legacy_src text not null default '',
  alt text not null default '' check(length(alt) <= 300),
  caption text not null default '' check(length(caption) <= 160),
  category text not null default '' check(length(category) <= 80),
  position integer not null check(position between 0 and 99),
  visible boolean not null default true,
  check(asset_id is null or legacy_src = ''),
  check((kind in ('hero','logo') and id = kind) or (kind in ('salon','portfolio') and id ~ '^[a-z]+:[a-zA-Z0-9-]{1,80}$'))
);
insert into private.site_images(id,kind,legacy_src,alt,caption,category,position) values
 ('hero','hero','/images/salon.jpg','Интерьер салона с креслами и круглыми зеркалами','','',0),
 ('logo','logo','','','','',0),
 ('salon:initial','salon','/images/salon.jpg','Интерьер салона','','',0),
 ('portfolio:hair','portfolio','/images/hair.jpg','Мягкая текстура','Мягкая текстура','Укладка и локоны',0),
 ('portfolio:nails','portfolio','/images/nails.jpg','Графичные акценты','Графичные акценты','Маникюр с покрытием',1),
 ('portfolio:makeup','portfolio','/images/master-elina.jpg','Естественное сияние','Естественное сияние','Лёгкий дневной макияж',2);

alter table public.masters add column photo_asset_id uuid references private.site_media_assets(id);
alter table public.masters add column photo_alt text not null default '' check(length(photo_alt) <= 300);
alter table public.masters add column photo_version bigint not null default 0;

alter table private.site_media_assets enable row level security;
alter table private.site_images enable row level security;
alter table private.site_content_state enable row level security;
revoke all on private.site_media_assets, private.site_images, private.site_content_state from public,anon,authenticated,service_role;

-- Only the server writes processed WebP. Raw originals never enter Storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('site-media','site-media',false,5242880,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policies also defeat an unrelated permissive policy for authenticated users.
create policy site_media_server_only on storage.objects as restrictive for all to anon,authenticated
using(bucket_id <> 'site-media') with check(bucket_id <> 'site-media');
create policy site_media_bucket_server_only on storage.buckets as restrictive for all to anon,authenticated
using(id <> 'site-media') with check(id <> 'site-media');

create function private.assert_media_admin(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null or not exists(select 1 from private.admin_users where user_id=p_actor) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
end;
$$;
create function private.site_content_json(p_admin boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('revision',(select revision from private.site_content_state where id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'assetId',i.asset_id,
      'legacySrc',i.legacy_src,'alt',i.alt,'caption',i.caption,'category',i.category,
      'position',i.position,'visible',i.visible) order by i.kind,i.position,i.id)
      from private.site_images i where p_admin or i.visible),'[]'::jsonb));
$$;
create function public.get_site_content() returns jsonb
language sql stable security definer set search_path='' as $$ select private.site_content_json(false); $$;
create function public.get_site_content_admin() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin perform private.assert_admin(); return private.site_content_json(true); end;
$$;

create function public.save_site_content(p_items jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; asset uuid; old_src text; item_count integer;
begin
  perform private.assert_admin();
  perform pg_advisory_xact_lock(713506,1);
  if p_expected_revision is distinct from (select revision from private.site_content_state where id) then raise exception 'CONTENT_CHANGED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or length(p_items::text)>100000 or jsonb_array_length(p_items)>100 then raise exception 'INVALID_CONTENT'; end if;
  select count(*) into item_count from jsonb_array_elements(p_items) x where x->>'id'='hero' and x->>'kind'='hero';
  if item_count <> 1 then raise exception 'INVALID_CONTENT'; end if;
  select count(*) into item_count from jsonb_array_elements(p_items) x where x->>'id'='logo' and x->>'kind'='logo';
  if item_count <> 1 or (select count(*) from jsonb_array_elements(p_items)) <> (select count(distinct x->>'id') from jsonb_array_elements(p_items) x) then raise exception 'INVALID_CONTENT'; end if;
  for v in select * from jsonb_array_elements(p_items) loop
    asset := nullif(v->>'assetId','')::uuid;
    if asset is not null and not exists(select 1 from private.site_media_assets where id=asset and state='ready') then raise exception 'IMAGE_NOT_READY'; end if;
    -- A browser can retain an existing legacy image or clear it, never introduce a URL/path.
    select legacy_src into old_src from private.site_images where id=v->>'id' and kind=v->>'kind';
    if coalesce(v->>'legacySrc','') <> '' and (asset is not null or (v->>'legacySrc') is distinct from old_src) then raise exception 'INVALID_IMAGE_REFERENCE'; end if;
    if jsonb_typeof(v->'visible') is distinct from 'boolean' or jsonb_typeof(v->'position') is distinct from 'number' then raise exception 'INVALID_CONTENT'; end if;
    insert into private.site_images(id,kind,asset_id,legacy_src,alt,caption,category,position,visible)
    values(v->>'id',v->>'kind',asset,coalesce(v->>'legacySrc',''),btrim(coalesce(v->>'alt','')),btrim(coalesce(v->>'caption','')),btrim(coalesce(v->>'category','')),(v->>'position')::integer,(v->>'visible')::boolean)
    on conflict(id) do update set kind=excluded.kind,asset_id=excluded.asset_id,legacy_src=excluded.legacy_src,alt=excluded.alt,caption=excluded.caption,category=excluded.category,position=excluded.position,visible=excluded.visible;
  end loop;
  delete from private.site_images where id not in (select x->>'id' from jsonb_array_elements(p_items) x);
  update private.site_content_state set revision=revision+1 where id;
  return private.site_content_json(true);
end;
$$;

-- Preserve the existing profile/schedule transaction, adding image CAS in the same transaction.
alter function private.master_json(public.masters) rename to master_json_before_media;
create function private.master_json(m public.masters) returns jsonb
language sql stable set search_path='' as $$
  select private.master_json_before_media(m) || jsonb_build_object('photoAssetId',m.photo_asset_id,'photoAlt',m.photo_alt,'photoVersion',m.photo_version);
$$;
alter function public.admin_apply_changes(jsonb,bigint,boolean) set schema private;
create function public.admin_apply_changes(p_changes jsonb,p_expected_revision bigint,p_allow_conflicts boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; current_master public.masters; asset uuid; clean_changes jsonb := p_changes; clean_masters jsonb := '[]';
begin
  perform private.assert_admin();
  perform private.lock_salon();
  perform pg_advisory_xact_lock(713506,1);
  for v in select * from jsonb_array_elements(coalesce(p_changes->'masters','[]')) loop
    select * into current_master from public.masters where id=v->>'id';
    if v ? 'photoAssetId' then
      if coalesce((v->>'photoVersion')::bigint,0) is distinct from coalesce(current_master.photo_version,0) then raise exception 'IMAGE_CHANGED'; end if;
      asset := nullif(v->>'photoAssetId','')::uuid;
      if asset is not null and not exists(select 1 from private.site_media_assets where id=asset and state='ready') then raise exception 'IMAGE_NOT_READY'; end if;
    end if;
    if coalesce(v->>'photo','') <> '' and (v->>'photo') is distinct from current_master.photo then raise exception 'INVALID_IMAGE_REFERENCE'; end if;
    clean_masters := clean_masters || jsonb_build_array(v);
  end loop;
  if p_changes ? 'masters' then clean_changes := jsonb_set(clean_changes,'{masters}',clean_masters); end if;
  perform private.admin_apply_changes(clean_changes,p_expected_revision,p_allow_conflicts);
  for v in select * from jsonb_array_elements(coalesce(p_changes->'masters','[]')) loop
    if v ? 'photoAssetId' then
      update public.masters set photo_asset_id=nullif(v->>'photoAssetId','')::uuid,
        photo_alt=btrim(coalesce(v->>'photoAlt','')),photo_version=photo_version+1 where id=v->>'id';
    end if;
  end loop;
  return public.get_admin_snapshot();
end;
$$;

-- Server-only RPCs. p_actor MUST come from verified Auth getUser(), never request JSON.
create function public.media_begin_upload(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.site_media_assets;
begin
  perform private.assert_media_admin(p_actor);
  perform pg_advisory_xact_lock(713506,1);
  if private.take_booking_quota('media:'||p_actor::text,3600,60)>0 then raise exception 'MEDIA_RATE_LIMIT'; end if;
  insert into private.site_media_assets(created_by) values(p_actor) returning * into a;
  return jsonb_build_object('id',a.id,'path',a.object_path);
end;
$$;
create function public.media_finish_upload(p_actor uuid,p_id uuid,p_width integer,p_height integer,p_bytes integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_media_admin(p_actor);
  perform pg_advisory_xact_lock(713506,1);
  update private.site_media_assets set state='ready',width=p_width,height=p_height,bytes=p_bytes
  where id=p_id and created_by=p_actor and state='pending'
    and exists(select 1 from storage.objects where bucket_id='site-media' and name=p_id::text||'.webp');
  if not found then raise exception 'IMAGE_NOT_READY'; end if;
end;
$$;
create function public.media_asset_paths(p_ids uuid[],p_actor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if array_length(p_ids,1)>100 then raise exception 'INVALID_CONTENT'; end if;
  if p_actor is not null then perform private.assert_media_admin(p_actor); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.object_path))
    from private.site_media_assets a where a.id=any(p_ids) and a.state='ready'
    and (p_actor is not null or exists(select 1 from private.site_images i where i.asset_id=a.id and i.visible)
      or exists(select 1 from public.masters m where m.photo_asset_id=a.id))),'[]'::jsonb);
end;
$$;

-- Claim under the SAME lock as publication. A deleting asset can never be reattached.
-- Keep unreferenced uploads for 24h so drafts and interrupted requests can recover.
create function public.media_gc_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(713506,1);
  with candidates as (
    select a.id from private.site_media_assets a
    where (a.created_at < now()-interval '24 hours' or a.state='deleting')
      and not exists(select 1 from private.site_images i where i.asset_id=a.id)
      and not exists(select 1 from public.masters m where m.photo_asset_id=a.id)
    order by a.created_at limit 50
  ), claimed as (
    update private.site_media_assets a set state='deleting' from candidates c where a.id=c.id returning a.id,a.object_path
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path)),'[]'::jsonb) into result from claimed;
  return result;
end;
$$;
create function public.media_gc_finish(p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(713506,1);
  delete from private.site_media_assets a where id=any(p_ids) and state='deleting'
    and not exists(select 1 from private.site_images i where i.asset_id=a.id)
    and not exists(select 1 from public.masters m where m.photo_asset_id=a.id);
end;
$$;

revoke all on function private.assert_media_admin(uuid),private.site_content_json(boolean),private.master_json(public.masters),private.master_json_before_media(public.masters),private.admin_apply_changes(jsonb,bigint,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_site_content(),public.get_site_content_admin(),public.save_site_content(jsonb,bigint),public.admin_apply_changes(jsonb,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_site_content() to anon,authenticated;
grant execute on function public.get_site_content_admin(),public.save_site_content(jsonb,bigint),public.admin_apply_changes(jsonb,bigint,boolean) to authenticated;
revoke all on function public.media_begin_upload(uuid),public.media_finish_upload(uuid,uuid,integer,integer,integer),public.media_asset_paths(uuid[],uuid),public.media_gc_claim(),public.media_gc_finish(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.media_begin_upload(uuid),public.media_finish_upload(uuid,uuid,integer,integer,integer),public.media_asset_paths(uuid[],uuid),public.media_gc_claim(),public.media_gc_finish(uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
