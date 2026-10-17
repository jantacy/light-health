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
-- 体重存两位小数（显示保留一位）。从 numeric(5,1) 放宽，已有数值不变。
alter table public.weight_records alter column weight_kg type numeric(5,2);
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

-- 每日热量阈值（kcal），首页进度和趋势图的目标线用；为空时按 2000。
alter table public.user_profiles add column if not exists calorie_goal smallint check (calorie_goal between 800 and 5000);
grant update (calorie_goal) on public.user_profiles to authenticated;
-- 目标体重（kg），首页按最近一次体重算差额。
alter table public.user_profiles add column if not exists target_weight numeric(4,1) check (target_weight between 25 and 300);
grant update (target_weight) on public.user_profiles to authenticated;
-- 主题色（src/lib/theme.ts 里的预设 id，空为默认青绿）。
alter table public.user_profiles add column if not exists theme text check (theme ~ '^[a-z]{1,20}$');
grant update (theme) on public.user_profiles to authenticated;

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

-- 应用配置（键值对，仅服务端/SQL 修改）。food_refresh_every：同一食物每被使用多少次触发一次 AI 重估。
create table if not exists public.app_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('food_refresh_every', '30') on conflict (key) do nothing;

-- 食物使用次数：每保存一条饮食记录，按其中食物的库键（items[].key，旧记录没有则用名称去空格小写）累加；每满 N 次（app_settings.food_refresh_every）标记待更新，由服务端定时让 AI 重估。
alter table public.food_library add column if not exists uses integer not null default 0;
alter table public.food_library add column if not exists needs_refresh boolean not null default false;
alter table public.food_library add column if not exists refreshed_at timestamptz;

create or replace function public.count_food_uses() returns trigger language plpgsql security definer set search_path = public as $$
declare
  every integer := coalesce((select nullif(value, '')::integer from public.app_settings where key = 'food_refresh_every'), 30);
begin
  if every < 1 then every := 30; end if;
  update public.food_library f
     set uses = f.uses + c.n,
         needs_refresh = f.needs_refresh or (f.uses % every) + c.n >= every
    from (select coalesce(nullif(i->>'key', ''), lower(regexp_replace(i->>'name', '\s+', '', 'g'))) as k, count(*) as n
            from jsonb_array_elements(coalesce(new.dishes, '[]'::jsonb)) d,
                 jsonb_array_elements(coalesce(d->'items', '[]'::jsonb)) i
           group by 1) c
   where f.name = c.k;
  return new;
end $$;
drop trigger if exists meal_records_count_food_uses on public.meal_records;
create trigger meal_records_count_food_uses after insert on public.meal_records for each row execute function public.count_food_uses();

-- 服务端认领待更新的食物（多台服务器同时跑也不会重复处理）。
create or replace function public.claim_food_refresh(max_rows integer default 10) returns setof public.food_library language sql security definer set search_path = public as $$
  update public.food_library set needs_refresh = false
   where name in (select name from public.food_library where needs_refresh and source not in ('cfct', 'manual') order by uses desc limit max_rows for update skip locked)
  returning *;
$$;
revoke all on function public.claim_food_refresh(integer) from public, anon, authenticated;
revoke all on function public.count_food_uses() from public, anon, authenticated;

-- 《中国食物成分表标准版（第6版）》导入的权威数据：source = 'cfct'，AI 不覆盖、不重估（导入见 scripts/import-cfct.mts）。
-- 管理页（/admin）手动修改或新增的记为 source = 'manual'，同样不被 AI 重估。
alter table public.food_library drop constraint if exists food_library_source_check;
alter table public.food_library add constraint food_library_source_check check (source in ('ai', 'photo', 'manual', 'cfct'));
