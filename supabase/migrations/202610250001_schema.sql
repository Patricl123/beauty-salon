-- No real users, contacts, appointments or credentials are seeded here.
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
alter extension btree_gist set schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table private.admin_users enable row level security;
-- Only the project owner / SQL editor provisions this table. Never trust user_metadata.

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.admin_users where user_id = auth.uid() and active);
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

create table public.services (
  id text primary key check(length(id) between 1 and 80),
  category text not null check(category in ('hair','nails','brows','makeup','care')),
  name text not null check(length(btrim(name)) between 2 and 100),
  description text not null default '' check(length(description) <= 2000),
  price integer not null check(price between 0 and 1000000),
  duration integer not null check(duration between 15 and 600 and duration % 15 = 0),
  active boolean not null default true
);
create table public.masters (
  id text primary key check(length(id) between 1 and 80),
  name text not null check(length(btrim(name)) between 1 and 80),
  specialty text not null default '' check(length(specialty) <= 200),
  photo text not null default '' check(photo = '' or photo ~ '^(/images/[^[:space:]]+|https://[^[:space:]]+)$'),
  days integer[] not null default array[1,2,3,4,5] check(days <@ array[0,1,2,3,4,5,6]),
  start_time time not null default '09:00',
  end_time time not null default '20:00',
  break_start time,
  break_end time,
  days_off date[] not null default '{}',
  vacation_start date,
  vacation_end date,
  check(start_time < end_time),
  check((break_start is null and break_end is null) or (break_start is not null and break_end is not null and break_start < break_end and break_start >= start_time and break_end <= end_time)),
  check((vacation_start is null and vacation_end is null) or (vacation_start is not null and vacation_end is not null and vacation_start <= vacation_end))
);
create table public.master_services (
  master_id text not null references public.masters(id) on delete cascade,
  service_id text not null references public.services(id) on delete restrict,
  primary key(master_id, service_id)
);
create table public.salon_settings (
  id boolean primary key default true check(id),
  name text not null default 'AURA' check(length(btrim(name)) between 1 and 40),
  tagline text not null default 'Beauty Bishkek' check(length(tagline) <= 60),
  address text not null default '' check(length(address) <= 500),
  phone text not null default '' check(phone = '' or phone ~ '^\+996[0-9]{9}$'),
  email text not null default '' check(length(email) <= 254),
  start_time time not null default '09:00',
  end_time time not null default '20:00',
  days integer[] not null default array[0,1,2,3,4,5,6] check(days <@ array[0,1,2,3,4,5,6]),
  cancellation_policy text not null default 'Перенос и отмена доступны до начала визита по персональному коду управления.' check(length(cancellation_policy) <= 4000),
  check(start_time < end_time)
);
insert into public.salon_settings(id) values(true);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references public.services(id) on delete restrict,
  master_id text not null references public.masters(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration integer not null check(duration between 15 and 600),
  price integer not null check(price between 0 and 1000000),
  service_name text not null,
  client_name text not null check(length(btrim(client_name)) between 2 and 80),
  phone text not null check(phone ~ '^\+996[0-9]{9}$'),
  comment text not null default '' check(length(comment) <= 500),
  status text not null default 'pending' check(status in ('pending','confirmed','arrived','completed','cancelled','noshow')),
  owner text not null default 'visitor' check(owner in ('visitor','salon')),
  version integer not null default 1 check(version > 0),
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at = start_at + duration * interval '1 minute'),
  constraint appointments_no_overlap exclude using gist (
    master_id extensions.gist_text_ops with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status not in ('cancelled','noshow'))
);
create index appointments_start_idx on public.appointments(start_at);
create index appointments_phone_idx on public.appointments(phone);
create table public.time_blocks (
  id text primary key,
  master_id text not null references public.masters(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null default '' check(length(reason) <= 500),
  check(end_at > start_at and end_at <= start_at + interval '1 day')
);
create index time_blocks_master_idx on public.time_blocks(master_id, start_at);
create table public.client_notes (
  phone text primary key check(phone ~ '^\+996[0-9]{9}$'),
  note text not null check(length(note) <= 10000),
  updated_at timestamptz not null default now()
);
create table public.notification_settings (
  id boolean primary key default true check(id),
  settings jsonb not null default '{"channels":["WhatsApp"],"reminder24":true,"reminder2":true,"templates":{"created":"{name}, запись {number}: {service}, {date} в {time}. Мастер {master}.","confirmed":"{name}, запись {number} подтверждена: {date} в {time}.","rescheduled":"{name}, запись {number} перенесена на {date}, {time}.","cancelled":"{name}, запись {number} отменена.","reminder24":"{name}, завтра {service}, {time}.","reminder2":"{name}, через 2 часа {service}, {time}.","schedule":"Расписание мастера {master} изменено."}}'::jsonb,
  check(jsonb_typeof(settings) = 'object')
);
insert into public.notification_settings(id) values(true);
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  event text not null,
  recipient text not null,
  channel text not null check(channel in ('SMS','WhatsApp','email')),
  message text not null,
  planned_at timestamptz not null,
  planned boolean not null default false,
  delivery_status text not null default 'not_sent' check(delivery_status = 'not_sent'),
  created_at timestamptz not null default now()
);
create table private.appointment_access (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  token_hash text not null unique check(length(token_hash) = 64)
);
create table private.idempotency_requests (
  actor text not null,
  request_id uuid not null,
  operation text not null,
  payload_hash text not null,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(actor, request_id)
);
create table private.system_state (id boolean primary key default true check(id), revision bigint not null default 1);
insert into private.system_state(id) values(true);

-- No table writes for API roles: all writes go through validated, transactional RPCs.
-- Even an authenticated Supabase user is not an administrator without the allowlist.
do $$
declare table_name text;
begin
  foreach table_name in array array['services','masters','master_services','salon_settings','appointments','time_blocks','client_notes','notification_settings','notification_events'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', table_name);
  end loop;
end;
$$;
alter table private.appointment_access enable row level security;
alter table private.idempotency_requests enable row level security;
alter table private.system_state enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
commit;
