-- Migration D (PROPOSED, NOT APPLIED) — Stage 8: admin aggregate statistics
-- Design rules:
--  * Admin never reads individual rows. Only SECURITY DEFINER functions that return aggregates.
--  * Every function checks public.is_admin() first (same pattern as admin_list_users).
--  * Operational counts (sessions, responses) are for running the service -> no consent needed.
--  * Research statistics use ONLY users with research_ok = true (live join: withdrawing consent removes them).
--  * Item statistics use ONLY users with calibration_ok = true and only COMPLETED sessions.
--  * Small-number protection: breakdowns are hidden when < 20 consented results; any cell < 5 is returned as null;
--    per-content stats need >= 30 answers from >= 5 different users.
--  * No tables are created or altered. Nothing existing changes. Rollback = drop the 3 functions.

create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'sessions_total',      (select count(*) from public.test_sessions),
    'completed',           (select count(*) from public.test_sessions where status = 'completed'),
    'in_progress',         (select count(*) from public.test_sessions where status = 'in_progress'),
    'abandoned',           (select count(*) from public.test_sessions where status = 'abandoned'),
    'users_with_sessions', (select count(distinct user_id) from public.test_sessions),
    'responses_total',     (select count(*) from public.test_responses),
    'results_total',       (select count(*) from public.test_results),
    'consent_research',    (select count(*) from public.research_consents where research_ok),
    'consent_calibration', (select count(*) from public.research_consents where calibration_ok)
  );
end $$;

create or replace function public.admin_research_summary()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare total int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select count(*) into total
    from public.test_results r join public.research_consents c on c.user_id = r.user_id and c.research_ok;
  if total < 20 then
    return jsonb_build_object('consented_results', total, 'insufficient', true, 'min_total', 20, 'min_cell', 5);
  end if;
  return (
    with c as (
      select r.* from public.test_results r
      join public.research_consents rc on rc.user_id = r.user_id and rc.research_ok
    ), d as (
      select e from c, jsonb_array_elements(case when jsonb_typeof(c.dichotomies) = 'array' then c.dichotomies else '[]'::jsonb end) e
    )
    select jsonb_build_object(
      'consented_results', total, 'insufficient', false, 'min_total', 20, 'min_cell', 5,
      'types', (select coalesce(jsonb_object_agg(t, case when n < 5 then null else n end), '{}'::jsonb)
                from (select mbti_type t, count(*) n from c where mbti_type is not null group by 1) x),
      'letters', (select coalesce(jsonb_object_agg(l, case when n < 5 then null else n end), '{}'::jsonb)
                from (select e->>'letter' l, count(*) n from d where e->>'letter' is not null group by 1) x),
      'confidence', (select coalesce(jsonb_object_agg(l, case when n < 5 then null else n end), '{}'::jsonb)
                from (select e->>'confidence_label' l, count(*) n from d where e->>'confidence_label' is not null group by 1) x),
      'results_with_facets', (select count(*) from c where c.facets <> '{}'::jsonb)
    )
  );
end $$;

create or replace function public.admin_content_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'min_n', 30, 'min_users', 5, 'descriptive_only', true,
    'rows', (
      select coalesce(jsonb_agg(x order by x.content_id), '[]'::jsonb) from (
        select p.content_id,
               count(*) as n,
               count(distinct s.user_id) as users,
               case when count(*) >= 30 and count(distinct s.user_id) >= 5
                    then round(avg(p.answer)::numeric, 1) end as mean_level,
               case when count(*) >= 30 and count(distinct s.user_id) >= 5
                    then jsonb_build_object(
                      '20',  count(*) filter (where p.answer = 20),
                      '50',  count(*) filter (where p.answer = 50),
                      '75',  count(*) filter (where p.answer = 75),
                      '100', count(*) filter (where p.answer = 100)) end as dist
        from public.test_responses p
        join public.test_sessions s on s.id = p.session_id and s.status = 'completed'
        join public.research_consents c on c.user_id = s.user_id and c.calibration_ok
        group by p.content_id
      ) x
    )
  );
end $$;

revoke all on function public.admin_overview()          from public, anon;
revoke all on function public.admin_research_summary()  from public, anon;
revoke all on function public.admin_content_stats()     from public, anon;
grant execute on function public.admin_overview()          to authenticated;
grant execute on function public.admin_research_summary()  to authenticated;
grant execute on function public.admin_content_stats()     to authenticated;

-- rollback:
--   drop function public.admin_overview(); drop function public.admin_research_summary(); drop function public.admin_content_stats();
