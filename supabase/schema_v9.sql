-- Puroductive v9 — reorderable task queues + per-task duration, optional
-- completion photos, and a manual leaderboard-eligibility toggle.
--
-- WHAT THIS ADDS
-- --------------
-- 1. tasks: two independent orderings (queue_order — position within the
--    task's own project pipeline; personal_queue_order — position within
--    the assignee's personal queue), plus estimated_minutes/active_minutes/
--    started_at for a self-contained per-task duration timer, plus
--    completion_photo_path for the optional "attach a photo when marking
--    complete" feature. All nullable/defaulted — every existing row keeps
--    working exactly as it does today with these simply unset.
--
--    Both orderings are `double precision` (fractional) rather than integer
--    ranks: inserting a task between two existing ones is just
--    `(prev.queue_order + next.queue_order) / 2`, so a drag-and-drop
--    reorder only ever touches the one row that moved, never the rest of
--    the list.
--
-- 2. team_members.competes_on_leaderboard — a manual per-person switch
--    (default on) so the "board room force" can be scored separately from
--    the "working force" roster entries who have no login at all. Boolean-
--    as-integer, matching the existing is_external/is_default_delegate
--    convention on this same table.
--
-- 3. The 'task-media' storage bucket — a private bucket for the optional
--    completion photo, policies identical in shape to schema_v5.sql's
--    'post-media' bucket (object path is '<workspace_id>/<task_id>/<file>',
--    and the policies read that first path segment).
--
-- Run once, after schema_v4.sql (needs is_workspace_member()/
-- can_write_workspace()). Safe to re-run.

-- ============================================================================
-- 1. TASKS — queue ordering + duration + completion photo
-- ============================================================================
alter table public.tasks add column if not exists queue_order double precision;
alter table public.tasks add column if not exists personal_queue_order double precision;
alter table public.tasks add column if not exists estimated_minutes integer;
alter table public.tasks add column if not exists active_minutes integer not null default 0;
alter table public.tasks add column if not exists started_at text;
alter table public.tasks add column if not exists completion_photo_path text;

create index if not exists idx_tasks_queue_order
  on public.tasks (project_id, queue_order);
create index if not exists idx_tasks_personal_queue_order
  on public.tasks (assignee_id, personal_queue_order);

-- ============================================================================
-- 2. TEAM MEMBERS — leaderboard eligibility
-- ============================================================================
alter table public.team_members add column if not exists competes_on_leaderboard integer not null default 1;

-- ============================================================================
-- 3. STORAGE — the 'task-media' bucket (completion photos)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-media', 'task-media', false,
  15728640,  -- 15 MB — a single completion photo, not a video
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "task media readable by workspace" on storage.objects;
create policy "task media readable by workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-media'
    and public.is_workspace_member((storage.foldername(name))[1])
  );

drop policy if exists "task media writable by workspace" on storage.objects;
create policy "task media writable by workspace" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-media'
    and public.can_write_workspace((storage.foldername(name))[1])
  );

drop policy if exists "task media removable by workspace" on storage.objects;
create policy "task media removable by workspace" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-media'
    and public.can_write_workspace((storage.foldername(name))[1])
  );
