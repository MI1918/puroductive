-- Row Level Security for Puroductive.
--
-- This is a single-tenant tool (one person/team managing multiple companies),
-- not a multi-tenant SaaS — the schema has no per-row "owner" column. The
-- login screen exists to keep the workspace private, not to partition data
-- between different users. So the rule here is simple: any row is fully
-- readable/writable by any *signed-in* user, and completely inaccessible to
-- anonymous requests.
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
      'projects', 'project_phases', 'tasks', 'task_transitions', 'handoffs',
      'reflections', 'attachments', 'daily_notes', 'work_sessions',
      'calendar_exceptions', 'sync_log'
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
