-- Rollback of Migration D (applied 2026-11-17 as "admin_aggregate_statistics"). No tables/data are touched.
drop function public.admin_overview();
drop function public.admin_research_summary();
drop function public.admin_content_stats();
