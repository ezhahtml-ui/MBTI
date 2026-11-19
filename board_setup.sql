-- =====================================================================
-- تەختەی پێشەنگەکان. دوای level_setup.sql لە SQL Editor ڕایبکە.
-- =====================================================================
-- قۆناغ: ١=لیڤڵ ١-٩ ، ٢=١٠-١٩ ... ١٠=٩٠-٩٩ ، ١١=لیڤڵ ١٠٠
create or replace function public.tier_of(l int) returns int
language sql immutable as $$ select case when l >= 100 then 11 when l <= 9 then 1 else l/10 + 1 end $$;

-- p_tier = 0 : بەرزترین لە هەموو ئەپەکەدا | ١..١١ : بەرزترین لەناو هەمان قۆناغ   (تۆپ ٩٩)
create or replace function public.leaderboard(p_tier int default 0)
returns table(pos int, user_id uuid, display_name text, username text, mbti_type text, total_xp int, lvl int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select p.id, p.display_name, p.username, p.mbti_type, p.xp, public.level_of(p.xp) l
    from public.profiles p where p.xp > 0 and auth.uid() is not null
  ), f as (
    select * from r where p_tier = 0 or public.tier_of(r.l) = p_tier
  )
  select (row_number() over (order by f.xp desc, f.display_name, f.id))::int,
         f.id, f.display_name, f.username, f.mbti_type, f.xp, f.l, (f.id = auth.uid())
  from f order by 1 limit 99;
$$;

-- ڕیزی خۆم: لە هەموو ئەپەکە + لەناو قۆناغی خۆم
create or replace function public.my_ranks()
returns table(overall int, tier_pos int, tier int)
language sql stable security definer set search_path = public as $$
  with r as (
    select p.id, p.xp, public.tier_of(public.level_of(p.xp)) t,
           row_number() over (order by p.xp desc, p.display_name, p.id) o
    from public.profiles p where p.xp > 0
  ), t as (
    select r2.id, r2.o, r2.t,
           row_number() over (partition by r2.t order by r2.o) tp from r r2
  )
  select t.o::int, t.tp::int, t.t from t where t.id = auth.uid();
$$;

revoke all on function public.leaderboard(int), public.my_ranks() from public, anon;
grant execute on function public.leaderboard(int), public.my_ranks() to authenticated;
notify pgrst, 'reload schema';
