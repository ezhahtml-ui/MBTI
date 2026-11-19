-- =====================================================================
-- MBTI app: فۆڵۆ، گەڕان، دەستکاری پڕۆفایل
-- لە Supabase Dashboard > SQL Editor بیخەرە ناو پڕۆژەی  rmalzfubkyrwubgoiwsq  و Run بکە.
-- دەتوانرێت چەند جارێک ڕابکرێت (idempotent).
-- =====================================================================

-- 1) خانەی نوێ لە profiles
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists age int;
alter table public.profiles add column if not exists name_changed_at timestamptz;
alter table public.profiles add column if not exists username_changed_at timestamptz;
alter table public.profiles add column if not exists age_changed_at timestamptz;

create unique index if not exists profiles_username_key
  on public.profiles (lower(username)) where username is not null;

-- 2) خشتەی فۆڵۆ (هیچ دەستڕاگەیشتنێکی ڕاستەوخۆ نییە؛ هەمووی لە ڕێگەی فەنکشنەوە)
create table if not exists public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  seen         boolean not null default false,
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;

-- 3) گەڕان بۆ ئەندام (تەنها id، ناو، ناسناو، جۆر دەگەڕێنێتەوە)
create or replace function public.search_profiles(q text)
returns table(id uuid, display_name text, username text, mbti_type text, i_follow boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, p.mbti_type,
         exists(select 1 from public.follows f
                where f.follower_id = auth.uid() and f.following_id = p.id)
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and length(ltrim(btrim(q), '@')) >= 2
    and ( position(lower(ltrim(btrim(q), '@')) in lower(coalesce(p.display_name, ''))) > 0
       or position(lower(ltrim(btrim(q), '@')) in lower(coalesce(p.username, ''))) > 0 )
  order by p.display_name
  limit 20;
$$;

-- 4) فۆڵۆ / ئەنفۆڵۆ
create or replace function public.follow_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if target = auth.uid() then raise exception 'self_follow'; end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'user_not_found';
  end if;
  insert into public.follows(follower_id, following_id)
  values (auth.uid(), target) on conflict do nothing;
end $$;

create or replace function public.unfollow_user(target uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.follows
  where follower_id = auth.uid() and following_id = target;
$$;

-- 5) ژمارەکان: فۆڵۆوەر، فۆڵۆکراو، فۆڵۆوەری نوێ (هێشتا نەبینراو)
create or replace function public.follow_stats()
returns table(followers int, following int, new_followers int)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.follows where following_id = auth.uid()),
         (select count(*)::int from public.follows where follower_id  = auth.uid()),
         (select count(*)::int from public.follows where following_id = auth.uid() and not seen);
$$;

create or replace function public.mark_followers_seen()
returns void language sql security definer set search_path = public as $$
  update public.follows set seen = true where following_id = auth.uid() and not seen;
$$;

-- 6) لیستی فۆڵۆوەرەکان / فۆڵۆکراوەکان  (kind = 'followers' | 'following')
create or replace function public.list_follows(kind text)
returns table(id uuid, display_name text, username text, mbti_type text, i_follow boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, p.mbti_type,
         exists(select 1 from public.follows f2
                where f2.follower_id = auth.uid() and f2.following_id = p.id)
  from public.follows f
  join public.profiles p
    on p.id = case when kind = 'followers' then f.follower_id else f.following_id end
  where auth.uid() is not null
    and ( (kind = 'followers' and f.following_id = auth.uid())
       or (kind = 'following' and f.follower_id  = auth.uid()) )
  order by f.created_at desc
  limit 200;
$$;

-- 7) پڕۆفایلی خۆم
create or replace function public.my_profile()
returns table(display_name text, username text, age int,
              name_changed_at timestamptz, username_changed_at timestamptz, age_changed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.display_name, p.username, p.age, p.name_changed_at, p.username_changed_at, p.age_changed_at
  from public.profiles p where p.id = auth.uid();
$$;

-- 8) دەستکاری پڕۆفایل لەگەڵ سنووری کات (لای سێرڤەر جێبەجێ دەکرێت، نەک تەنها لە ئەپ)
--    ناو: ٧ ڕۆژ | ناسناو: ٦٠ ڕۆژ | تەمەن: ٦٠ ڕۆژ
create or replace function public.update_my_profile(
  p_name text default null, p_username text default null, p_age int default null)
returns table(display_name text, username text, age int,
              name_changed_at timestamptz, username_changed_at timestamptz, age_changed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cur public.profiles%rowtype;
  v_name text; v_user text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into public.profiles(id) values (me) on conflict (id) do nothing;
  select * into cur from public.profiles where id = me for update;

  if p_name is not null then
    v_name := btrim(p_name);
    if length(v_name) < 2 or length(v_name) > 40 then raise exception 'bad_name'; end if;
    if v_name is distinct from cur.display_name then
      if cur.name_changed_at is not null and cur.name_changed_at > now() - interval '7 days' then
        raise exception 'cooldown_name'; end if;
      update public.profiles set display_name = v_name, name_changed_at = now() where id = me;
    end if;
  end if;

  if p_username is not null then
    v_user := lower(btrim(p_username));
    if v_user !~ '^[a-z0-9_.]{3,20}$' then raise exception 'bad_username'; end if;
    if v_user is distinct from lower(cur.username) then
      if cur.username_changed_at is not null and cur.username_changed_at > now() - interval '60 days' then
        raise exception 'cooldown_username'; end if;
      begin
        update public.profiles set username = v_user, username_changed_at = now() where id = me;
      exception when unique_violation then
        raise exception 'username_taken';
      end;
    end if;
  end if;

  if p_age is not null then
    if p_age < 10 or p_age > 99 then raise exception 'bad_age'; end if;
    if p_age is distinct from cur.age then
      if cur.age_changed_at is not null and cur.age_changed_at > now() - interval '60 days' then
        raise exception 'cooldown_age'; end if;
      update public.profiles set age = p_age, age_changed_at = now() where id = me;
    end if;
  end if;

  return query select p.display_name, p.username, p.age, p.name_changed_at, p.username_changed_at, p.age_changed_at
               from public.profiles p where p.id = me;
end $$;

-- 9) تەنها بەکارهێنەری چووەژوورەوە دەتوانێت فەنکشنەکان بانگ بکات
revoke all on function public.search_profiles(text), public.follow_user(uuid), public.unfollow_user(uuid),
  public.follow_stats(), public.mark_followers_seen(), public.list_follows(text), public.my_profile(),
  public.update_my_profile(text, text, int) from public, anon;
grant execute on function public.search_profiles(text), public.follow_user(uuid), public.unfollow_user(uuid),
  public.follow_stats(), public.mark_followers_seen(), public.list_follows(text), public.my_profile(),
  public.update_my_profile(text, text, int) to authenticated;

notify pgrst, 'reload schema';
