-- UrbanEye: sanitize existing report colors and block unapproved values.
-- Safe to run more than once.

update public.reports
set color = '#1769e0'
where color is not null
  and lower(color) not in ('#e53935', '#f5a623', '#1769e0', '#22a06b', '#7a5af8');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_color_palette_check'
  ) then
    alter table public.reports
      add constraint reports_color_palette_check
      check (color is null or lower(color) in ('#e53935', '#f5a623', '#1769e0', '#22a06b', '#7a5af8'));
  end if;
end;
$$;
