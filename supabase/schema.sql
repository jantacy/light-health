-- Run once in Supabase SQL Editor. Admins issue a License for each E.164 phone
-- through /admin/licenses. A phone can have exactly one active License row.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_licenses (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\\+[1-9][0-9]{7,14}$'),
  license_hash text not null unique,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_licenses enable row level security;
-- No client policies: phone/license mappings are server-only.

create table if not exists public.meal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null check (char_length(title) between 1 and 160),
  image_path text,
  calories numeric(8,1) not null default 0 check (calories >= 0),
  protein_g numeric(7,1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(7,1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(7,1) not null default 0 check (fat_g >= 0),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists meal_records_user_eaten_idx on public.meal_records (user_id, eaten_at desc);
alter table public.meal_records enable row level security;
drop policy if exists "Users read own meals" on public.meal_records;
create policy "Users read own meals" on public.meal_records for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users add own meals" on public.meal_records;
create policy "Users add own meals" on public.meal_records for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users edit own meals" on public.meal_records;
create policy "Users edit own meals" on public.meal_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own meals" on public.meal_records;
create policy "Users delete own meals" on public.meal_records for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.weight_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_on date not null default current_date,
  weight_kg numeric(5,1) not null check (weight_kg between 20 and 400),
  created_at timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index if not exists weight_records_user_day_idx on public.weight_records (user_id, recorded_on desc);
alter table public.weight_records enable row level security;
drop policy if exists "Users read own weights" on public.weight_records;
create policy "Users read own weights" on public.weight_records for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users add own weights" on public.weight_records;
create policy "Users add own weights" on public.weight_records for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users edit own weights" on public.weight_records;
create policy "Users edit own weights" on public.weight_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own weights" on public.weight_records;
create policy "Users delete own weights" on public.weight_records for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'];
drop policy if exists "Users read own meal photos" on storage.objects;
create policy "Users read own meal photos" on storage.objects for select to authenticated using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users upload own meal photos" on storage.objects;
create policy "Users upload own meal photos" on storage.objects for insert to authenticated with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own meal photos" on storage.objects;
create policy "Users delete own meal photos" on storage.objects for delete to authenticated using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
