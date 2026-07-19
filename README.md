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

1. In your Supabase project's SQL editor, run [`supabase/rls.sql`](supabase/rls.sql).
   This enables Row Level Security on every table and adds a policy so only
   **signed-in** users can read/write — this app has no per-user data
   partitioning, it's a single private workspace behind a login screen, not a
   multi-tenant product.
2. Optionally run [`supabase/seed.sql`](supabase/seed.sql) to pre-populate the
   two example companies and four team members. **There is no "add company" or
   "add team member" screen in the UI** — that was never built, even in the
   original prototype. If you need different companies/people, either edit
   `seed.sql` before running it, or add/edit rows directly in the Supabase
   Table Editor after the fact.
3. In Supabase → Authentication → Providers, make sure Email is enabled. By
   default Supabase requires email confirmation on sign-up; either confirm via
   the email you receive, or turn "Confirm email" off in Authentication →
   Settings for faster local testing.
4. Grab your Project URL and anon/public key from Project Settings → API.

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

Tables actually read/written by the UI: `companies` (read-only), `team_members`
+ `member_company_links` (read-only), `projects`, `tasks`, `task_transitions`,
`handoffs`, `reflections`, `calendar_exceptions`, `work_sessions`.

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
  seed.sql               — optional starter companies/team members
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
