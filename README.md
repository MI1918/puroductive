# Puroductive

Cross-company project & task supervisor with a strict state machine, a
non-dismissible "reflect on what went wrong" flow for missed deadlines, a
handoff/retry loop, and monthly productivity reporting. Built with
React + Vite, backed by Supabase (Postgres + Auth).

## Stack

- React 18 + Vite
- Supabase (Postgres for data, Supabase Auth for login)
- No other backend — the browser talks to Supabase directly using the
  anon/public key, protected by Row Level Security (RLS)

## One-time Supabase setup

Run these SQL files **in order** in your Supabase project's SQL editor:

1. [`supabase/rls.sql`](supabase/rls.sql) — enables Row Level Security on
   every table.
2. [`supabase/schema_v2.sql`](supabase/schema_v2.sql) — adds team-member
   groups and the calendar events table used by the Companies/Team/Calendar
   management screens.
3. [`supabase/schema_v3.sql`](supabase/schema_v3.sql) — turns this into a
   real multi-tenant app: every table gets an `owner_id` column and RLS is
   rewritten so **each signed-in user only ever sees their own data**.
   Anyone you share the deployed link with gets their own private, empty
   workspace on signup — nothing is shared and nothing is erased. **Open the
   file and replace `YOUR-LOGIN-EMAIL@example.com` with the email you
   personally sign into Puroductive with before running it** — that's whose
   account your existing companies/projects/tasks get assigned to.
   ([`supabase/seed.sql`](supabase/seed.sql) predates per-user ownership and
   will fail with a "null value in column owner_id" error if run after this
   — it's obsolete now that Companies/Team have full add screens in the UI.)
4. [`supabase/schema_v4.sql`](supabase/schema_v4.sql) — **shared workspaces.**
   v3 made every row private to its owner, which meant two people could never
   see the same project. v4 changes the rule from *"you own it"* to *"you're a
   member of its workspace"*, and adds invites, roles
   (owner/admin/member/viewer), individual-vs-team tasks, calendar task
   marking, and leave tracking with reasons.

   It is **purely additive** — `owner_id` is kept, nothing is dropped, and
   every row you have today is moved into a personal workspace owned by
   whoever owns it now, so you sign in afterwards and see exactly what you saw
   before. **Take a database backup first** (Dashboard → Database → Backups):
   this rewrites RLS policies on twelve tables and the script can't back
   itself up. Safe to re-run.

   Unlike v3, this one needs no editing before you run it — it discovers the
   owners from the data itself.

   `task_transitions` and `reflections` carry append-only triggers that refuse
   every UPDATE, so the script suspends them just long enough to stamp
   `workspace_id` onto rows written before workspaces existed, then switches
   them straight back on — all inside one transaction, so a failure rolls the
   suspension back too. **The script's final query is the receipt: every row
   in the Results pane must say `ENABLED`.** If any says `DISABLED`, restore
   your backup instead of using the app — a disabled trigger means the
   reflection log is silently editable.
5. [`supabase/schema_v5.sql`](supabase/schema_v5.sql) — **the collaborative
   board.** Posts with an intent (update / discussion / task request / poll /
   accomplished), photo and video attachments, comments, votes, and task
   requests with an append-only paper trail. Also creates the **private**
   `post-media` storage bucket and its access policies.

   Purely additive — it only creates new tables. If you skip it, everything
   else keeps working and the Board screen tells you it needs running.
6. In Supabase → Authentication → URL Configuration, set **Site URL** to
   your deployed URL (e.g. `https://mi1918.github.io/puroductive/`) and add
   it to **Redirect URLs**. This is what was sending confirmation-email links
   to `localhost` instead of the live site — Supabase redirects there by
   default regardless of what the app requests unless this is set. If you
   also develop locally, add `http://localhost:5173/puroductive/` (or
   whatever port Vite prints) to Redirect URLs too.
7. In Supabase → Authentication → Providers, make sure Email is enabled. By
   default Supabase requires email confirmation on sign-up; either confirm via
   the email you receive, or turn "Confirm email" off in Authentication →
   Settings for faster local testing.
8. Grab your Project URL and anon/public key from Project Settings → API.

## Workspaces, invites and roles

Since v4 the app is multi-user. Two things that look similar but aren't:

- **Team** (`team_members`) is a roster of *names you can assign work to*.
  Entries here need no account and never did.
- **People & access** (`workspace_members`) is *accounts that can open this
  workspace*. Inviting someone can optionally link them to a roster entry, at
  which point the tasks already assigned to that name become theirs.

Invites are addressed to an email, not a user id, so you can invite someone
who has never opened Puroductive. `claim_workspace_invites()` runs on every
sign-in and attaches any invite matching that account's email — which is why
an invited person just signs up normally and finds the workspace waiting.

Roles: **owner** > **admin** > **member** > **viewer**. A viewer's writes are
refused by RLS at the database, not merely hidden in the UI. You may only
grant or change roles strictly below your own, so an admin cannot demote the
owner or remove a fellow admin.

Everyone also keeps a **personal** workspace, created automatically on signup
by a trigger on `auth.users`. It is private, cannot be shared, and is where
all your pre-v4 data now lives.

## Local setup

Requires [Node.js](https://nodejs.org) (18+) — not installed in the
environment this project was scaffolded in, so the steps below haven't been
run end-to-end here. Do this on your own machine:

```bash
npm install
cp .env.example .env
# edit .env and paste in your Supabase Project URL + anon key
npm run dev
```

Then open the printed local URL, sign up for an account, and sign in.

## What's wired to Supabase vs. what isn't

Tables actually read/written by the UI: `companies`, `team_members`
+ `member_company_links`, `member_groups`, `projects`, `tasks`, `task_transitions`,
`handoffs`, `reflections`, `calendar_exceptions`, `calendar_events`, `work_sessions`,
`workspaces`, `workspace_members`, `posts`, `post_media`, `post_comments`,
`poll_options`, `poll_votes`, `task_requests`, `task_request_events`.

Present in the schema but **not** used by this UI (no screen exercises them):
`phase_templates`, `project_phases`, `attachments`, `daily_notes`, `sync_log`,
`meta`. They're untouched — safe to ignore or build UI for later.

`version` and `device_id` are legacy columns from an earlier local-first,
multi-device sync design (see `baseline backup/ARCHITECTURE.md`). Now that
Supabase is the one shared database, they're still written (schema requires
`device_id`) but never read back or reconciled.

## Project structure

```
src/
  main.jsx              — entry point, wraps the app in AuthGate
  App.jsx               — the app: engines (state machine, sand stack,
                           reports), all views, wired to lib/db.js
  auth/AuthGate.jsx      — Supabase Auth email/password login + signup
  lib/supabaseClient.js  — Supabase client (reads VITE_SUPABASE_* env vars)
  lib/db.js              — maps the Postgres schema <-> the app's data shapes
  lib/ids.js             — uid/timestamp/device-id helpers
supabase/
  rls.sql                — Row Level Security setup (run once)
  schema_v2.sql           — member groups + calendar events tables (run once)
  schema_v3.sql           — per-user ownership + RLS rewrite (run once)
  schema_v4.sql           — shared workspaces, invites, roles, team tasks,
                            leave tracking; RLS rewritten again (run once)
  schema_v5.sql           — the board: posts, media, comments, polls, task
                            requests + paper trail, storage bucket (run once)
  seed.sql               — legacy starter data, predates per-user ownership
baseline backup/
  ARCHITECTURE.md        — the original local-first core design this UI's
                           engines were ported from (context/history only)
```

## Build for deployment

```bash
npm run build
```

Outputs static files to `dist/` — deployable to Vercel, Netlify, GitHub
Pages, or any static host. Remember to set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables on whatever host you use.
