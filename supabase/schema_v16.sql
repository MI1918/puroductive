-- Puroductive v16 — task notes, photo notes, and task comments (items 7 & 8).
--
-- WHAT THIS ADDS
-- --------------
-- One table serves both asks rather than building two overlapping systems:
-- a note with task_id set and no photo reads as a task comment; a note
-- with a photo and no task_id reads as a quick "photo of something at this
-- project, not yet tied to a task" capture. task_id is nullable specifically
-- for that second case.
--
-- Storage mirrors task-media's bucket + path-prefix RLS shape exactly
-- (schema_v9.sql) — object path is '<workspace_id>/<project_id>/<file>'.
--
-- Run once, after schema_v4.sql. Safe to re-run.

create table if not exists public.task_notes (
  id            text primary key,
  workspace_id  text not null references public.workspaces(id),
  project_id    text not null references public.projects(id),
  task_id       text references public.tasks(id),
  author_id     uuid not null references auth.users(id) default auth.uid(),
  body          text not null default '',
  photo_path    text,
  created_at    text not null
);

create index if not exists idx_task_notes_project on public.task_notes (project_id, created_at);
create index if not exists idx_task_notes_task on public.task_notes (task_id) where task_id is not null;

alter table public.task_notes enable row level security;

drop policy if exists "task notes readable by workspace" on public.task_notes;
create policy "task notes readable by workspace" on public.task_notes
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "task notes insertable by workspace writers" on public.task_notes;
create policy "task notes insertable by workspace writers" on public.task_notes
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-notes', 'task-notes', false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "task note photos readable by workspace" on storage.objects;
create policy "task note photos readable by workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-notes'
    and public.is_workspace_member((storage.foldername(name))[1])
  );

drop policy if exists "task note photos writable by workspace" on storage.objects;
create policy "task note photos writable by workspace" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-notes'
    and public.can_write_workspace((storage.foldername(name))[1])
  );
