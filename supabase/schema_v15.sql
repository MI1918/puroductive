-- Puroductive v15 — task edit + reflective deadline extension (item 10).
--
-- WHAT THIS ADDS
-- --------------
-- deadline_extensions: a permanent record of every *voluntary* deadline
-- move, made before a task goes overdue. Deliberately its own table rather
-- than reusing `reflections` — reflections' three columns
-- (what_went_wrong/root_bottleneck/corrective_action) are worded for the
-- "you missed it" supervisor intervention; an extension is asked before
-- that happens and needs a different set of questions plus the actual
-- old→new date, so a shared table would either force reflections' columns
-- to carry two different meanings or need a bunch of nullable extras.
--
-- No UPDATE or DELETE policy is created — same "permanent" guarantee
-- reflections gets from its append-only trigger (schema_v4.sql), just
-- achieved here by never granting the capability at all, since this table
-- has no prior UPDATE policy to defend against.
--
-- Run once, after schema_v4.sql. Safe to re-run.

create table if not exists public.deadline_extensions (
  id             text primary key,
  task_id        text not null references public.tasks(id),
  project_id     text not null references public.projects(id),
  workspace_id   text not null references public.workspaces(id),
  old_deadline   text not null,
  new_deadline   text not null,
  what_changed   text not null,
  progress_so_far text not null,
  plan_to_hold   text not null,
  created_at     text not null
);

create index if not exists idx_deadline_extensions_workspace on public.deadline_extensions (workspace_id);
create index if not exists idx_deadline_extensions_task on public.deadline_extensions (task_id);
create index if not exists idx_deadline_extensions_project on public.deadline_extensions (project_id);

alter table public.deadline_extensions enable row level security;

drop policy if exists "deadline extensions readable by workspace" on public.deadline_extensions;
create policy "deadline extensions readable by workspace" on public.deadline_extensions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "deadline extensions insertable by workspace writers" on public.deadline_extensions;
create policy "deadline extensions insertable by workspace writers" on public.deadline_extensions
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id));
