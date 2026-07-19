-- Row Level Security for Puroductive — baseline step.
--
-- This is the first of three setup scripts (see README.md): it just enables
-- RLS on every table and blocks anonymous access, with every signed-in user
-- sharing full access to every row. supabase/schema_v3.sql runs after this
-- (and after schema_v2.sql) and replaces the policy this file creates with
-- real per-user ownership, so each person who signs in only sees their own
-- data. Run this one first regardless — schema_v3.sql depends on RLS already
-- being enabled.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- after your tables already exist.

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'meta', 'companies', 'phase_templates', 'team_members', 'member_company_links',
      'member_groups', 'projects', 'project_phases', 'tasks', 'task_transitions', 'handoffs',
      'reflections', 'attachments', 'daily_notes', 'work_sessions',
      'calendar_exceptions', 'calendar_events', 'sync_log'
    ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format(
      'create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
