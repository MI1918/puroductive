-- Puroductive v5 — the collaborative board.
--
-- WHAT THIS ADDS
-- --------------
-- A workspace feed where people post images and videos with a caption, and
-- crucially where the post has an INTENT. The same photo of a half-finished
-- floor means very different things depending on why it was posted:
--
--   discussion    "what are your thoughts" — collect opinions
--   task_request  "@Ravi, this needs doing" — becomes a real task if accepted
--   poll          "which of these three" — collect votes
--   accomplished  "this is done" — claim credit against a task
--   update        plain caption, no response expected
--
-- THE PAPER TRAIL
-- ---------------
-- task_request_events is the point of the whole feature. When Ravi says "no,
-- that's Priya's job" and transfers it, the decline and the transfer are both
-- recorded permanently, so a report months later can show that the task
-- passed through two people before anyone started it. Nothing in this table
-- is ever updated or deleted — it is append-only by policy (no UPDATE policy
-- is created for it, so Postgres refuses updates outright).
--
-- Run once in the Supabase SQL editor, after schema_v4.sql. Safe to re-run.
-- Depends on v4's is_workspace_member() / can_write_workspace() helpers.

-- ============================================================================
-- 1. POSTS
-- ============================================================================

create table if not exists public.posts (
  id            text primary key,
  workspace_id  text not null references public.workspaces(id),
  author_id     uuid not null references auth.users(id) default auth.uid(),
  -- Which roster entry the author shows up as, when their account is linked
  -- to one. Null just means the post is bylined with their email.
  author_member_id text references public.team_members(id),
  kind          text not null default 'update'
                check (kind in ('update', 'discussion', 'task_request', 'poll', 'accomplished')),
  caption       text not null default '',
  -- Optional context. A post about a specific project shows up on it.
  project_id    text references public.projects(id),
  -- For 'accomplished': which task is being claimed as done.
  task_id       text references public.tasks(id),
  pinned        integer not null default 0,
  version       integer not null default 1,
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null,
  deleted_at    text
);
create index if not exists idx_posts_workspace_created
  on public.posts (workspace_id, created_at desc);

-- Media lives in Supabase Storage (bucket 'post-media'); this table holds the
-- object paths and ordering. Kept as rows rather than a JSON column because
-- deleting one image out of five should not mean rewriting the whole array.
create table if not exists public.post_media (
  id            text primary key,
  post_id       text not null references public.posts(id),
  workspace_id  text not null references public.workspaces(id),
  storage_path  text not null,
  media_type    text not null default 'image' check (media_type in ('image', 'video')),
  sort_order    integer not null default 0,
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null,
  deleted_at    text
);
create index if not exists idx_post_media_post on public.post_media (post_id);

-- "What are your thoughts" is answered here.
create table if not exists public.post_comments (
  id            text primary key,
  post_id       text not null references public.posts(id),
  workspace_id  text not null references public.workspaces(id),
  author_id     uuid not null references auth.users(id) default auth.uid(),
  author_member_id text references public.team_members(id),
  body          text not null,
  version       integer not null default 1,
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null,
  deleted_at    text
);
create index if not exists idx_post_comments_post on public.post_comments (post_id, created_at);

-- ============================================================================
-- 2. POLLS
-- ============================================================================

create table if not exists public.poll_options (
  id            text primary key,
  post_id       text not null references public.posts(id),
  workspace_id  text not null references public.workspaces(id),
  label         text not null,
  sort_order    integer not null default 0,
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null,
  deleted_at    text
);
create index if not exists idx_poll_options_post on public.poll_options (post_id, sort_order);

create table if not exists public.poll_votes (
  id            text primary key,
  post_id       text not null references public.posts(id),
  option_id     text not null references public.poll_options(id),
  workspace_id  text not null references public.workspaces(id),
  voter_id      uuid not null references auth.users(id) default auth.uid(),
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null
);
-- One vote per person per poll. Changing your mind updates the existing row's
-- option_id rather than inserting a second vote, which this index enforces.
create unique index if not exists uq_poll_votes_post_voter
  on public.poll_votes (post_id, voter_id);

-- ============================================================================
-- 3. TASK REQUESTS + THE PAPER TRAIL
-- ============================================================================

create table if not exists public.task_requests (
  id            text primary key,
  post_id       text not null references public.posts(id),
  workspace_id  text not null references public.workspaces(id),
  -- Set once accepted: the real task this became, which from then on lives in
  -- the ordinary state machine like any other task.
  task_id       text references public.tasks(id),
  project_id    text references public.projects(id),
  title         text not null,
  deadline      text,
  weight        integer not null default 1,
  requested_by  uuid not null references auth.users(id) default auth.uid(),
  -- Who it is currently sitting with. Moves on every transfer; the history of
  -- where it has been is in task_request_events, never overwritten here.
  assignee_member_id text references public.team_members(id),
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'transferred', 'cancelled')),
  version       integer not null default 1,
  updated_at    text not null,
  device_id     text not null default 'app',
  created_at    text not null,
  deleted_at    text
);
create index if not exists idx_task_requests_post on public.task_requests (post_id);
create index if not exists idx_task_requests_workspace on public.task_requests (workspace_id, status);

-- Append-only. Every requested / accepted / declined / transferred moment,
-- with the reason given, so a report can reconstruct exactly how a task
-- reached whoever finally did it.
create table if not exists public.task_request_events (
  id            text primary key,
  request_id    text not null references public.task_requests(id),
  workspace_id  text not null references public.workspaces(id),
  action        text not null check (action in ('requested', 'accepted', 'declined', 'transferred', 'cancelled')),
  from_member_id text references public.team_members(id),
  to_member_id   text references public.team_members(id),
  reason        text,
  actor_id      uuid not null references auth.users(id) default auth.uid(),
  device_id     text not null default 'app',
  created_at    text not null
);
create index if not exists idx_task_request_events_request
  on public.task_request_events (request_id, created_at);

-- ============================================================================
-- 4. RLS — same workspace rule as every other table
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'posts', 'post_media', 'post_comments', 'poll_options', 'poll_votes',
    'task_requests', 'task_request_events'
  ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "workspace read" on public.%I;', t);
    execute format('drop policy if exists "workspace write" on public.%I;', t);
    execute format('drop policy if exists "workspace update" on public.%I;', t);

    execute format(
      'create policy "workspace read" on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id));', t);
    execute format(
      'create policy "workspace write" on public.%I for insert to authenticated
         with check (public.can_write_workspace(workspace_id));', t);
  end loop;
end $$;

-- UPDATE is granted only where something is genuinely mutable, and only to
-- the person it belongs to. task_request_events is deliberately absent: with
-- no UPDATE policy, Postgres refuses every update, which is what makes the
-- paper trail tamper-evident rather than merely by convention.
--
-- Each is preceded by its own DROP — CREATE POLICY has no IF NOT EXISTS, so
-- without this a second run of the script would fail with "policy already
-- exists" the moment it reached here, contrary to this file's own claim of
-- being safe to re-run.
drop policy if exists "author edits own post" on public.posts;
create policy "author edits own post" on public.posts
  for update to authenticated
  using (author_id = auth.uid() and public.can_write_workspace(workspace_id))
  with check (author_id = auth.uid() and public.can_write_workspace(workspace_id));

drop policy if exists "author edits own comment" on public.post_comments;
create policy "author edits own comment" on public.post_comments
  for update to authenticated
  using (author_id = auth.uid() and public.can_write_workspace(workspace_id))
  with check (author_id = auth.uid() and public.can_write_workspace(workspace_id));

-- Media rows are tombstoned by the post's author when they remove an image.
drop policy if exists "workspace update" on public.post_media;
create policy "workspace update" on public.post_media
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

-- Changing your vote rewrites your own row, and only your own.
drop policy if exists "voter changes own vote" on public.poll_votes;
create policy "voter changes own vote" on public.poll_votes
  for update to authenticated
  using (voter_id = auth.uid() and public.can_write_workspace(workspace_id))
  with check (voter_id = auth.uid() and public.can_write_workspace(workspace_id));

-- Any writing member can act on a request — that is the point: it lands with
-- Ravi, but Priya may be the one who picks it up after he declines.
drop policy if exists "workspace update" on public.task_requests;
create policy "workspace update" on public.task_requests
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

drop policy if exists "workspace update" on public.poll_options;
create policy "workspace update" on public.poll_options
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

-- ============================================================================
-- 5. STORAGE — the 'post-media' bucket
-- ============================================================================
--
-- Private bucket: images are fetched through signed URLs, so a leaked object
-- path is not enough to view someone's site photos. Object paths are
-- '<workspace_id>/<post_id>/<file>', and the policies below read that first
-- path segment to decide access — which is why the app must never write an
-- object outside its own workspace folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media', 'post-media', false,
  52428800,  -- 50 MB, enough for a phone video clip
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
        'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post media readable by workspace" on storage.objects;
create policy "post media readable by workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-media'
    and public.is_workspace_member((storage.foldername(name))[1])
  );

drop policy if exists "post media writable by workspace" on storage.objects;
create policy "post media writable by workspace" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and public.can_write_workspace((storage.foldername(name))[1])
  );

drop policy if exists "post media removable by workspace" on storage.objects;
create policy "post media removable by workspace" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-media'
    and public.can_write_workspace((storage.foldername(name))[1])
  );
