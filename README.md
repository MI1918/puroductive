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
4. In Supabase → Authentication → URL Configuration, set **Site URL** to
   your deployed URL (e.g. `https://mi1918.github.io/puroductive/`) and add
   it to **Redirect URLs**. This is what was sending confirmation-email links
   to `localhost` instead of the live site — Supabase redirects there by
   default regardless of what the app requests unless this is set. If you
   also develop locally, add `http://localhost:5173/puroductive/` (or
   whatever port Vite prints) to Redirect URLs too.
5. In Supabase → Authentication → Providers, make sure Email is enabled. By
   default Supabase requires email confirmation on sign-up; either confirm via
   the email you receive, or turn "Confirm email" off in Authentication →
   Settings for faster local testing.
6. Grab your Project URL and anon/public key from Project Settings → API.

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
`handoffs`, `reflections`, `calendar_exceptions`, `calendar_events`, `work_sessions`.

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
