import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
export const TEST_ADMIN_ID = "10000000-0000-4000-8000-000000000001";
export const TEST_USER_ID = "10000000-0000-4000-8000-000000000002";
export const bootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to service_role;
  create schema auth;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
  -- Storage service schema subset for SQL/RLS tests; file bytes are tested separately.
  create schema storage;
  create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  alter table storage.buckets enable row level security;
  grant usage on schema storage to anon,authenticated,service_role;
  grant all on storage.objects,storage.buckets to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated;
  alter default privileges in schema public grant all on tables to anon,authenticated;
`;
export function migrationFiles() {
  return readdirSync(path.resolve("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.resolve("supabase/migrations", name), "utf8"),
    }));
}
export async function createTestDatabase(options: { legacy?: boolean } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(bootstrap);
  for (const file of migrationFiles().filter(
    (file) => !options.legacy || file.name.startsWith("20261025"),
  ))
    await db.exec(file.sql);
  await db.exec(readFileSync(path.resolve("supabase/seed.sql"), "utf8"));
  await db.exec(
    `insert into auth.users(id) values('${TEST_ADMIN_ID}'),('${TEST_USER_ID}'); insert into private.admin_users(user_id) values('${TEST_ADMIN_ID}'); update public.masters set days=array[0,1,2,3,4,5,6];`,
  );
  return db;
}
