-- Puroductive v13 — Batch 2: richer notifications (item 21).
--
-- WHAT THIS ADDS
-- --------------
-- Two new notification kinds, each backed by a SECURITY DEFINER trigger
-- (same shape as schema_v6.sql's trg_fn_notify_on_invite — no INSERT policy
-- on notifications for `authenticated`, so every row is still only ever
-- written by a trigger, never forgeable by a client):
--
-- 1. 'task_assigned' — fires on tasks insert/update whenever assignee_id is
--    set (or changes) to a team_members row that's linked to an *active*
--    account (workspace_members.member_id). Self-assignment doesn't notify
--    you about yourself.
-- 2. 'handoff_requested' — fires on handoffs insert, notifying whoever the
--    task was just handed to (same team_members -> workspace_members ->
--    auth.users resolution).
--
-- Both reuse the existing notifications.action_task_id column, so clicking
-- either one in the notification center already jumps to the right task —
-- openNotification() in App.jsx needed no changes for that.
--
-- Run once, after schema_v12.sql. Safe to re-run.

-- ============================================================================
-- 1. Widen the notifications.kind check constraint
-- ============================================================================

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'notifications'
      and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%kind%'
  loop
    execute format('alter table public.notifications drop constraint %I;', con.conname);
  end loop;
end $$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'invite_pending', 'invite_accepted', 'task_completed', 'project_completed',
    'google_access_requested', 'task_assigned', 'handoff_requested'
  ));

-- ============================================================================
-- 2. task_assigned
-- ============================================================================

create or replace function public.trg_fn_notify_on_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_uid uuid;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;

  select wm.user_id into target_uid
  from public.workspace_members wm
  where wm.member_id = new.assignee_id and wm.status = 'active' and wm.deleted_at is null and wm.user_id is not null
  limit 1;
  if target_uid is null or target_uid = auth.uid() then return new; end if;

  insert into public.notifications
    (id, user_id, workspace_id, kind, title, body, action_task_id, created_at)
  values (
    'nt-' || replace(gen_random_uuid()::text, '-', ''), target_uid, new.workspace_id,
    'task_assigned', 'New task assigned to you', new.title, new.id, now_txt
  );
  return new;
end $$;

drop trigger if exists on_task_assigned on public.tasks;
create trigger on_task_assigned
  after insert or update of assignee_id on public.tasks
  for each row execute function public.trg_fn_notify_on_task_assigned();

revoke execute on function public.trg_fn_notify_on_task_assigned() from anon, authenticated, public;

-- ============================================================================
-- 3. handoff_requested
-- ============================================================================

create or replace function public.trg_fn_notify_on_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_uid uuid;
  task_title text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if new.to_assignee_id is null then return new; end if;

  select wm.user_id into target_uid
  from public.workspace_members wm
  where wm.member_id = new.to_assignee_id and wm.status = 'active' and wm.deleted_at is null and wm.user_id is not null
  limit 1;
  if target_uid is null or target_uid = auth.uid() then return new; end if;

  select title into task_title from public.tasks where id = new.task_id;

  insert into public.notifications
    (id, user_id, workspace_id, kind, title, body, action_task_id, created_at)
  values (
    'nt-' || replace(gen_random_uuid()::text, '-', ''), target_uid, new.workspace_id,
    'handoff_requested', 'A task was handed off to you', coalesce(task_title, 'A task'), new.task_id, now_txt
  );
  return new;
end $$;

drop trigger if exists on_handoff_created on public.handoffs;
create trigger on_handoff_created
  after insert on public.handoffs
  for each row execute function public.trg_fn_notify_on_handoff();

revoke execute on function public.trg_fn_notify_on_handoff() from anon, authenticated, public;

-- ============================================================================
-- 4. VERIFY
-- ============================================================================

select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.notifications'::regclass and contype = 'c';
