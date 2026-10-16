-- Run once in Supabase SQL Editor. Admins issue a License for each E.164 phone
-- through /admin/licenses. A phone can have exactly one active License row.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_licenses (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  license_hash text not null unique,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 早期版本的 check 写成了 '^\\+...'，会拒绝所有 +86 号码；重复执行本文件即可修正。
alter table public.user_licenses drop constraint if exists user_licenses_phone_check;
alter table public.user_licenses add constraint user_licenses_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$');
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
-- 每餐的菜品明细：[{name, calories, protein_g, carbs_g, fat_g, image_path}]，餐的总营养是它们的和。
alter table public.meal_records add column if not exists dishes jsonb not null default '[]'::jsonb;
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

-- 用户资料。手机号和 user_id 由服务端在登录时写入；用户只能改昵称、性别、生日（星座由生日推算，不入库）。
create table if not exists public.user_profiles (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid unique references auth.users(id) on delete set null,
  nickname text check (char_length(nickname) <= 30),
  gender text check (gender in ('male', 'female')),
  birth_month smallint check (birth_month between 1 and 12),
  birth_day smallint check (birth_day between 1 and 31),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile" on public.user_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users edit own profile" on public.user_profiles;
create policy "Users edit own profile" on public.user_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke insert, update, delete on public.user_profiles from anon, authenticated;
grant update (nickname, gender, birth_month, birth_day, updated_at) on public.user_profiles to authenticated;

-- 头像：私有 bucket，每个用户只能读写自己目录下的文件；路径存在 user_profiles.avatar_path。
alter table public.user_profiles add column if not exists avatar_path text;
grant update (avatar_path) on public.user_profiles to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "Users read own avatar" on storage.objects;
create policy "Users read own avatar" on storage.objects for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 共享食物库：每 100 克的营养。AI 估算或识图得到的结果写入这里，之后同名食物直接查库，不再调用 AI。
-- 只允许服务端（service role）访问。
create table if not exists public.food_library (
  name text primary key,              -- 归一化后的名称（去空格、小写）
  display_name text not null,
  calories_100g numeric(7,1) not null check (calories_100g >= 0),
  protein_100g numeric(6,1) not null default 0 check (protein_100g >= 0),
  carbs_100g numeric(6,1) not null default 0 check (carbs_100g >= 0),
  fat_100g numeric(6,1) not null default 0 check (fat_100g >= 0),
  source text not null default 'ai' check (source in ('ai', 'photo', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.food_library enable row level security;
-- No client policies: server-only.
