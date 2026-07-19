# Personal Supervisor & Cross-Company Work Management — Phase 1: Core Data Layer

Platform-agnostic TypeScript core. Zero runtime dependencies (WebCrypto for UUID/SHA-256).
The identical code runs on Electron/Tauri (desktop) and Capacitor/React Native (Android)
behind a 4-method `SqlDriver` adapter.

## File structure

```
supervisor-core/
├── package.json                  # @supervisor/core — no runtime deps
├── tsconfig.json                 # strict mode, ES2022
├── ARCHITECTURE.md               # this file
├── src/
│   ├── index.ts                  # public barrel + createCore() composition root
│   ├── data/
│   │   └── schema.sql            # SQLite schema v1 + business-rule TRIGGERS
│   └── core/
│       ├── types.ts              # all domain types, states, events, ExportBundle
│       ├── ids.ts                # uuid(), nowIso(), todayYmd()
│       ├── db/
│       │   ├── driver.ts         # SqlDriver — the ONLY platform seam (4 methods)
│       │   └── database.ts       # bootstrap, migration runner, device_id, meta store
│       ├── repositories/
│       │   ├── base.ts           # generic CRUD: version bump, tombstones, sync upsert
│       │   ├── companies.ts      # companies + per-company phase templates + themes
│       │   ├── teamMembers.ts    # global roster + many-to-many company links
│       │   ├── projects.ts       # zero_to_one/ongoing semantics + one-way lock
│       │   ├── tasks.ts          # tasks (state column excluded from public writes)
│       │   ├── handoffs.ts       # delegation tracker ("Has Raj done the follow-up?")
│       │   ├── reflections.ts    # append-only Strict Supervisor log
│       │   └── attachments.ts    # photo-verification metadata (path + sha256)
│       ├── stateMachine/
│       │   └── taskStateMachine.ts  # transition table, guards, audit log, deadline sweep
│       ├── engines/
│       │   └── sandStack.ts      # pure math: fill %, degradation flags (no rendering)
│       ├── sync/
│       │   ├── exporter.ts       # deterministic, checksummed "No-Loss" JSON dump
│       │   └── importer.ts       # validated, transactional LWW merge + conflict report
│       └── seed/
│           └── seed.ts           # Shree Jagdamba, Form6, Raj/Niranjan/Puroshotam/vendor
└── test/
    └── smoke.ts                  # 26-assertion end-to-end test (real SQLite)
```

## Database schema (14 tables)

Every syncable table shares the same metadata columns:
`id` (UUIDv4) · `version` (monotonic counter) · `updated_at` · `device_id` · `created_at` · `deleted_at` (tombstone).

| Table | Purpose |
|---|---|
| `meta` | schema_version, device_id, installed_at |
| `companies` | multi-tenant root; `theme_json` holds the per-company gradient palette |
| `phase_templates` | reusable Standard Operational Phases per company |
| `team_members` | global cross-company pool; `is_default_delegate` flags Raj |
| `member_company_links` | many-to-many member↔company |
| `projects` | `type` zero_to_one/ongoing, `baseline_percent`, `deadline`, `locked_at` |
| `project_phases` | instantiated from templates at project creation |
| `tasks` | atomic sand-stack unit; `state`, `weight`, `photo_required`, `retry_count` |
| `task_transitions` | append-only audit log of every state change |
| `handoffs` | Retry/Handoff loop delegation records |
| `reflections` | append-only Strict Supervisor answers (3 mandatory fields) |
| `attachments` | photo verification (file path + sha256) |
| `daily_notes`, `work_sessions`, `calendar_exceptions` | productivity report inputs |
| `sync_log` | hash-stamped record of every export/import |

### Rules enforced by SQLite triggers (unbypassable by any code path)
1. **Project immutability** — once `locked_at` is set, `deadline`/`baseline_percent`
   reject UPDATE, even raw SQL.
2. **Reflections are permanent** — UPDATE and DELETE both abort.
3. **Transition log is append-only.**
4. **Tasks are never dismissed** — hard DELETE aborts; soft-delete is allowed only on
   completed tasks. Incomplete tasks must be moved through the state machine.

## Task state machine

```
pending ──START──▶ in_progress ──FAIL_ATTEMPT──▶ retry_pending ──REASSIGN/RESCHEDULE──▶ pending
   │                   │COMPLETE                      │COMPLETE
   │                   ▼                              ▼
   └─DEADLINE_PASSED─▶ overdue ──COMPLETE + mandatory reflection──▶ completed (completed_late=1)
```

- `tasks.state` is writable only via `TaskStateMachine.transition()` — the public
  repository whitelist physically excludes it.
- Guards: photo-required tasks demand ≥1 attachment to COMPLETE; overdue tasks demand
  the 3-field reflection; REASSIGN must open a `handoffs` record (defaulting to Raj).
- Every transition is atomic (guards → write → audit row → side records) in one txn.
- `sweepDeadlines()` runs on boot/timer and degrades past-deadline open tasks to
  `overdue`, which flips the sand stack's `degraded` flag until they are completed.

## Sync engine ("No-Loss" fail-safe)

**Export** — full dump of all 14 tables including tombstones and history, sorted by id
with canonical (recursively key-sorted) JSON, plus a SHA-256 checksum. The same
database always produces byte-identical output → version-control friendly.

**Import** — rejects wrong format, newer schema versions, and checksum mismatches
before touching the DB. Then merges per row inside a single transaction:

1. Unknown id → insert.
2. Higher `version` wins; ties broken by `updated_at`.
3. Same version + timestamp but different content → **true conflict**: local kept,
   conflict listed in the `ImportReport` (never silently dropped).
4. Append-only tables merge by id-union, preserving history from both devices.
5. Tombstones merge by the same rules, so deletions propagate across devices.

Every export/import lands in `sync_log` with its file hash.

## Wiring on any platform

```ts
const db = new Database(platformDriver, schemaSqlText);  // 4-method adapter
await db.init();                                          // idempotent
const core = createCore(db);
await seed(db);                                           // first run only
await core.stateMachine.sweepDeadlines();                 // degrade overdue on boot
```

## Verified

`tsc --strict` clean · 26-assertion smoke test on real SQLite covering: seeding,
template instantiation, project lock (repo + trigger), the full
START→FAIL→REASSIGN→overdue→COMPLETE lifecycle, reflection enforcement, sand-stack
degradation/restoration math, handoff auto-closing, a two-device export→import
round-trip, LWW conflict resolution, and tampered-file rejection.
