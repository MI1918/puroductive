-- Puroductive v3 — per-user private workspaces.
--
-- Until now this was a single shared workspace: rls.sql's policy let ANY
-- signed-in user read/write ALL rows. That was fine when only one person
-- used the app, but now the link gets shared — a friend who signs up must
-- get their own private companies/projects/tasks that nobody else, not even
-- you, can see. This adds an owner_id column to every table the app
-- actually reads/writes and replaces the "any signed-in user" RLS policy
-- with "only the row's owner".
--
-- New signups need no extra setup: owner_id defaults to auth.uid(), so
-- everything a person creates after signing up is automatically theirs, and
-- an empty account just sees empty Companies/Team/Projects pages — exactly
-- how a fresh workspace should look.
--
-- ============================================================================
-- BEFORE RUNNING: replace 'YOUR-LOGIN-EMAIL@example.com' below with the
-- exact email address you sign into Puroductive with. Every row already in
-- the database today (everything created before this migration existed)
-- will be assigned to that account, since none of it has an owner yet.
-- ============================================================================
--
-- Run this once in the Supabase SQL editor, after rls.sql and schema_v2.sql
-- have already been run (this migration touches the tables schema_v2.sql
-- creates, so order matters).

do $$
declare
  owner_email text := 'YOUR-LOGIN-EMAIL@example.com';  -- <-- change this, then run
  owner_uid uuid;
  t text;
begin
  select id into owner_uid from auth.users where email = owner_email;
  if owner_uid is null then
    raise exception 'No auth.users row found for email %. Double-check the address you sign into Puroductive with, edit owner_email above, and re-run.', owner_email;
  end if;

  for t in select unnest(array[
    'companies', 'team_members', 'member_company_links', 'member_groups',
    'projects', 'tasks', 'task_transitions', 'handoffs', 'reflections',
    'calendar_exceptions', 'calendar_events', 'work_sessions'
  ])
  loop
    -- 1. Add the column nullable first — auth.uid() has no meaning in this
    --    admin SQL-editor session, so a NOT NULL default here would fail on
    --    the existing rows. New rows going forward (from the real app,
    --    signed in as a real user) pick up auth.uid() automatically.
    execute format(
      'alter table public.%I add column if not exists owner_id uuid references auth.users(id) default auth.uid();', t
    );
    -- 2. Every row that predates this migration belongs to the account this
    --    workspace has been running as.
    execute format('update public.%I set owner_id = %L where owner_id is null;', t, owner_uid);
    -- 3. Now that every row has an owner, close the gap.
    execute format('alter table public.%I alter column owner_id set not null;', t);
    -- 4. RLS: a row is only visible to / writable by the user who owns it.
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format('drop policy if exists "owner full access" on public.%I;', t);
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());',
      t
    );
  end loop;
end $$;
