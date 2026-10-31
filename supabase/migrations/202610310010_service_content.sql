-- Service block text and category images share the existing media revision,
-- trusted upload pipeline, reference table and garbage-collection lock.
begin;

alter table private.site_images drop constraint site_images_kind_check;
alter table private.site_images drop constraint site_images_check1;
alter table private.site_images
  add constraint site_images_kind_check check(kind in ('hero','salon','logo','portfolio','service_category')),
  add constraint site_images_identity_check check(
    (kind in ('hero','logo') and id=kind)
    or (kind in ('salon','portfolio') and id ~ '^[a-z]+:[a-zA-Z0-9-]{1,80}$')
    or (kind='service_category' and category in ('hair','nails','brows','makeup','care') and id='category:'||category and visible)),
  add column title text not null default '' check(length(title)<=160);

alter table private.site_content_state add column services_block jsonb not null default
  '{"eyebrow":"МАЛЕНЬКИЕ РИТУАЛЫ КРАСОТЫ","headingBefore":"То, что вам","headingEmphasis":"нужно","headingAfter":"","description":"От любимой стрижки до часа тишины.\nВыбирайте заботу по настроению.","footnote":"Стоимость фиксируется при записи. Без онлайн-оплаты."}'::jsonb;

-- New fixed IDs only. Existing owner content and assets are untouched.
insert into private.site_images(id,kind,legacy_src,alt,caption,category,position,title) values
 ('category:hair','service_category','/images/hair.jpg','Вдохновение для категории «Волосы»','01 — ВАША НОВАЯ ИСТОРИЯ','hair',0,'Лёгкость в каждом движении'),
 ('category:nails','service_category','/images/nails.jpg','Вдохновение для категории «Ногти»','01 — ВАША НОВАЯ ИСТОРИЯ','nails',1,'Красота в деталях'),
 ('category:brows','service_category','/images/master-diana.jpg','Вдохновение для категории «Брови и ресницы»','01 — ВАША НОВАЯ ИСТОРИЯ','brows',2,'Позвольте себе сиять'),
 ('category:makeup','service_category','/images/master-elina.jpg','Вдохновение для категории «Макияж»','01 — ВАША НОВАЯ ИСТОРИЯ','makeup',3,'Позвольте себе сиять'),
 ('category:care','service_category','/images/care.jpg','Вдохновение для категории «Уход»','01 — ВАША НОВАЯ ИСТОРИЯ','care',4,'Позвольте себе сиять')
on conflict(id) do nothing;

create or replace function private.site_content_json(p_admin boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('revision',(select revision from private.site_content_state where id),
    'servicesBlock',(select services_block from private.site_content_state where id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'assetId',i.asset_id,
      'legacySrc',i.legacy_src,'alt',i.alt,'caption',i.caption,'category',i.category,'title',i.title,
      'position',i.position,'visible',i.visible) order by i.kind,i.position,i.id)
      from private.site_images i where p_admin or (i.visible and (i.kind<>'portfolio' or i.asset_id is not null))),'[]'::jsonb));
$$;

alter function public.save_site_content(jsonb,bigint) rename to save_site_content_before_services;
alter function public.save_site_content_before_services(jsonb,bigint) set schema private;
create function public.save_site_content(p_items jsonb,p_expected_revision bigint,p_services_block jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; k text; n integer; items jsonb := p_items;
begin
  perform private.assert_admin();
  perform pg_advisory_xact_lock(713506,1);
  if p_expected_revision is distinct from (select revision from private.site_content_state where id) then raise exception 'CONTENT_CHANGED'; end if;
  if items is null or jsonb_typeof(items)<>'array' or length(items::text)>100000 or jsonb_array_length(items)>100 then raise exception 'INVALID_CONTENT'; end if;
  select count(*) into n from jsonb_array_elements(items) x where x->>'kind'='service_category';
  if n=0 then
    -- Older clients must not erase category references or service text.
    items := items || (select jsonb_agg(x) from jsonb_array_elements(private.site_content_json(true)->'items') x where x->>'kind'='service_category');
  elsif n<>5 then raise exception 'INVALID_CONTENT'; end if;
  for v in select * from jsonb_array_elements(items) loop
    if v ? 'title' and (jsonb_typeof(v->'title') is distinct from 'string' or length(v->>'title')>160) then raise exception 'INVALID_CONTENT'; end if;
  end loop;
  if p_services_block is not null then
    if jsonb_typeof(p_services_block)<>'object' or not (p_services_block ?& array['eyebrow','headingBefore','headingEmphasis','headingAfter','description','footnote']) then raise exception 'INVALID_CONTENT'; end if;
    for k,v in select * from jsonb_each(p_services_block) loop
      if k not in ('eyebrow','headingBefore','headingEmphasis','headingAfter','description','footnote') or jsonb_typeof(v)<>'string'
        or length(p_services_block->>k)>(case when k='description' then 1000 when k='footnote' then 500 else 160 end) then raise exception 'INVALID_CONTENT'; end if;
    end loop;
  end if;
  -- Existing validation, ready-asset check, CAS and reference updates remain atomic.
  perform private.save_site_content_before_services(items,p_expected_revision);
  for v in select * from jsonb_array_elements(items) loop
    if v ? 'title' then update private.site_images set title=btrim(v->>'title') where id=v->>'id'; end if;
  end loop;
  if p_services_block is not null then update private.site_content_state set services_block=p_services_block where id; end if;
  return private.site_content_json(true);
end;
$$;
revoke all on function private.save_site_content_before_services(jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.save_site_content(jsonb,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_site_content(jsonb,bigint,jsonb) to authenticated;

-- media_asset_paths, media_gc_claim and media_gc_finish already inspect ALL
-- private.site_images rows. Category bindings now participate without a second
-- reference store, including categories that currently have no active services.
update private.site_content_state set revision=revision+1 where id;
notify pgrst,'reload schema';
commit;
