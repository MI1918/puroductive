import React, { useState, useEffect, useReducer, useRef } from "react";
import {
  LayoutGrid, FolderKanban, Users, Plus, Trash2, Lock, Phone, Mail, X, Check,
  AlertTriangle, ShieldCheck, Globe, ChevronRight, ChevronLeft, CircleDot,
  Play, PhoneMissed, RotateCcw, UserCheck, CalendarClock, History, ScrollText,
  Ban, Flame, CalendarDays, BarChart3, Bell, Download, LogIn, LogOut, Plane,
  TrendingUp, TrendingDown, Sun, Building2, Pencil, Tag, MapPin, Video,
  CalendarPlus, Briefcase, Menu, GanttChart, Trophy, UserPlus, Star,
  ChevronsUpDown, Eye, Send, Layers, Palmtree, MessageSquare, Image as ImageIcon,
  BarChart2, HelpCircle, PartyPopper, ArrowRightLeft, Paperclip,
  Crown, Medal, Zap, MessageCircle, Hash,
  GripVertical, Pause, Camera, Copy, KeyRound, Smartphone, Award,
  Pin, PinOff, ChevronDown, StickyNote, Search, Palette,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import * as db from "./lib/db.js";
import { getInitialTheme, applyTheme, applyAccent, getStoredAccent, storeAccent } from "./lib/theme.js";

/* ============================================================================
 * PURODUCTIVE — Phase 3: Logic Engines wired into the light fintech UI.
 *
 * Ported 1:1 from @supervisor/core:
 *   · TaskStateMachine  → pure TRANSITIONS table + guarded reducer
 *   · computeSandStack  → weighted fill % + degradation sources
 *   · Strict Supervisor → non-dismissible InterventionModal (3 mandatory
 *                         answers, permanently appended to the reflection log)
 *   · Handoff/Retry     → FAIL_ATTEMPT → retry_pending → forced REASSIGN
 *                         (tracked "Has [assignee] completed the follow-up?")
 *   · No-dismiss rule   → incomplete tasks cannot be deleted; the trash action
 *                         routes them into the retry loop instead.
 *
 * All engine state lives in ONE pure reducer (exported for headless testing) —
 * a drop-in seam for createCore() when the real SQLite layer is attached.
 * ==========================================================================*/

/* ------------------------------- DESIGN TOKENS --------------------------- */
/* Every value below is a CSS custom property, not a literal color — see
 * src/lib/theme.js for the light/dark definitions. Toggling the `data-theme`
 * attribute on <html> re-themes every one of these at once, everywhere they
 * appear, with no React re-render and no prop threading. The one deliberate
 * exception is the "ink button" pattern (Btn's `ink` variant): that always
 * wants a fixed dark surface with white text regardless of theme, so it uses
 * fixed dark-surface and white-text colors instead of these tokens — using
 * T.ink there would flip its background to a light color in dark mode while
 * the text stayed white, making it unreadable. */
const T = {
  bg: "var(--bg)", card: "var(--card)", cardSoft: "var(--card-soft)",
  line: "var(--line)", lineSoft: "var(--line-soft)",
  ink: "var(--ink)", ink2: "var(--ink2)", ink3: "var(--ink3)",
  lime: "var(--lime)", limeDeep: "var(--lime-deep)", danger: "var(--danger)",
  dangerBg: "var(--danger-bg)", dangerLine: "var(--danger-line)",
  fontDisplay: "'Sora', 'Inter', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  shadowSm: "var(--shadow-sm)", shadowMd: "var(--shadow-md)", shadowLg: "var(--shadow-lg)",
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")";

/* The moldy overlay the sand degrades into when deadlines are missed. */
const MOLD_MESH = ["#D8D9D2", "#AFB2A6", "#82857A"];
const MOLD_INK = "#3F423A";

/* item 5 — 12 presets now instead of 5, same {key,label,primary,ink,mesh:[3]}
 * shape used for a company's own theme and (v14) the per-workspace personal
 * accent — one color model, two use sites (CompanyForm and the accent
 * picker), via the shared ColorPicker component below. */
const THEME_PRESETS = [
  { key: "lime",    label: "Fresh Lime", primary: "#7CB518", ink: "#243305", mesh: ["#E9FBB7", "#C6F04D", "#8FD14F"] },
  { key: "mint",    label: "Sea Mint",   primary: "#0E9F6E", ink: "#093826", mesh: ["#D9FBEA", "#8FE3BE", "#4CC694"] },
  { key: "apricot", label: "Apricot",    primary: "#D97706", ink: "#4A2A03", mesh: ["#FDEED3", "#FBD38D", "#F6AD55"] },
  { key: "sky",     label: "Glass Sky",  primary: "#0284C7", ink: "#062F44", mesh: ["#DDF3FE", "#A5DFF9", "#67C3F0"] },
  { key: "lilac",   label: "Soft Lilac", primary: "#7C5CDB", ink: "#291D52", mesh: ["#EEE9FD", "#D3C6F8", "#B3A0F2"] },
  { key: "coral",   label: "Coral",      primary: "#E85D4E", ink: "#4A1710", mesh: ["#FDE2DC", "#F5A99A", "#EE7D68"] },
  { key: "rose",    label: "Rose",       primary: "#DB4C77", ink: "#4A0F26", mesh: ["#FCE4EE", "#F5A8C4", "#E8749D"] },
  { key: "amber",   label: "Amber",      primary: "#C9962C", ink: "#3D2B04", mesh: ["#FBF0D6", "#F0D48A", "#E0B354"] },
  { key: "teal",    label: "Deep Teal",  primary: "#0D9488", ink: "#062F2C", mesh: ["#D7F5F0", "#8FE0D3", "#4CBFAE"] },
  { key: "indigo",  label: "Indigo",     primary: "#4F46E5", ink: "#1E1B4B", mesh: ["#E4E3FD", "#B8B4F8", "#8A83F0"] },
  { key: "slate",   label: "Slate",      primary: "#475569", ink: "#1E2531", mesh: ["#E7EBEF", "#C2CCD6", "#94A3B4"] },
  { key: "plum",    label: "Plum",       primary: "#9333A6", ink: "#34093E", mesh: ["#F3E1F7", "#DDA8E8", "#C773D6"] },
];

/* -------------------------- custom color derivation -------------------------
 * Turns one picked hex into the full {primary, ink, mesh:[3]} shape above —
 * fixed lightness steps at the picked hue/saturation, so the result always
 * reads as a coherent theme regardless of exactly how light or dark the
 * picked color was (a near-black or near-white pick still derives a usable
 * mid-tone primary and a legible dark ink). */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
function deriveThemeFromHex(hex) {
  const [h, rawSat] = hexToHsl(hex);
  const sat = Math.min(Math.max(rawSat, 40), 75);
  return {
    key: "custom", label: "Custom", custom: true,
    primary: hslToHex(h, sat, 42),
    ink: hslToHex(h, Math.min(sat, 70), 14),
    mesh: [hslToHex(h, Math.max(sat - 15, 25), 90), hslToHex(h, sat, 78), hslToHex(h, sat, 62)],
  };
}

const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
export const isPast = (ymd) => !!ymd && new Date(ymd + "T23:59:59") < new Date();

/* ============================================================================
 * ENGINE 1 — TASK STATE MACHINE (ported from core/stateMachine)
 * ==========================================================================*/
export const TRANSITIONS = {
  pending:       { START: "in_progress", FAIL_ATTEMPT: "retry_pending", DEADLINE_PASSED: "overdue" },
  /* PAUSE (item 2) is a deliberate stop, not a failure — it hands the
   * "currently active" slot back to the queue without touching retryCount
   * or reassignment, so a paused CNC task can sit behind a newly-inserted
   * grinding step and simply wait its turn again. */
  in_progress:   { COMPLETE: "completed", PAUSE: "pending", FAIL_ATTEMPT: "retry_pending", DEADLINE_PASSED: "overdue" },
  retry_pending: { REASSIGN: "pending", RESCHEDULE: "pending", COMPLETE: "completed", DEADLINE_PASSED: "overdue" },
  overdue:       { COMPLETE: "completed", FAIL_ATTEMPT: "retry_pending" },
  completed:     {},
};
const STATE_META = {
  pending:       { label: "Pending",       color: "#8A8F99", bg: T.cardSoft },
  in_progress:   { label: "In progress",   color: "#0284C7", bg: "#EAF6FE" },
  retry_pending: { label: "Retry pending", color: "#B45309", bg: "#FDF3E3" },
  overdue:       { label: "Overdue",       color: "#B91C1C", bg: "#FDECEA" },
  completed:     { label: "Completed",     color: "#3F6212", bg: "#F2FADF" },
};

/* ------------------------- workspace roles (schema_v4) --------------------
 * Mirrors the check constraint on workspace_members.role. `rank` is what the
 * UI compares against — a role may only manage roles strictly below its own,
 * which is what stops an admin from demoting the owner. */
const ROLE_META = {
  owner:  { label: "Owner",  rank: 3, hint: "Full control, including deleting the workspace" },
  admin:  { label: "Admin",  rank: 2, hint: "Can invite people and manage roles" },
  member: { label: "Member", rank: 1, hint: "Can create and complete work" },
  viewer: { label: "Viewer", rank: 0, hint: "Read-only — can see everything, change nothing" },
};
const canWrite = (role) => ROLE_META[role]?.rank >= 1;
const canAdmin = (role) => ROLE_META[role]?.rank >= 2;

/* --------------------- calendar day types (schema_v4) ---------------------
 * holiday/travel predate v4 and mean "the calendar took this day". The two
 * leave types are a person's own time off and carry a reason, which is what
 * the month-end leave breakdown groups by. */
const EXCEPTION_META = {
  holiday:        { label: "Holiday", short: "Holiday", bg: "#FDEED3", color: "#4A2A03",
                    mesh: ["#FDEED3", "#FBD38D", "#F6AD55"], leave: false },
  travel:         { label: "Travel",  short: "Travel",  bg: "#DDF3FE", color: "#062F44",
                    mesh: ["#DDF3FE", "#A5DFF9", "#67C3F0"], leave: false },
  leave_declared: { label: "Leave declared (booked ahead)", short: "Leave booked",
                    bg: "#EEE9FD", color: "#291D52", mesh: ["#EEE9FD", "#D3C6F8", "#B3A0F2"], leave: true },
  leave_taken:    { label: "Leave taken", short: "Leave taken",
                    bg: "#FDECEA", color: "#7A1F12", mesh: ["#FDECEA", "#F8C6BD", "#F09A8A"], leave: true },
};
export const isLeaveType = (type) => !!EXCEPTION_META[type]?.leave;

/* ------------------------ board post kinds (schema_v5) --------------------
 * The intent of a post, chosen when it's written. The same site photo means
 * something different depending on which of these it's tagged as, and each
 * one gets a different response affordance underneath it. */
const POST_KIND_META = {
  update:       { label: "Update", blurb: "Just sharing — no response needed",
                  icon: MessageSquare, bg: T.cardSoft, color: T.ink2, posted: "Posted to the board" },
  discussion:   { label: "What are your thoughts?", blurb: "Open it up for everyone's opinion",
                  icon: HelpCircle, bg: "#EAF6FE", color: "#0284C7", posted: "Asked the team for thoughts" },
  task_request: { label: "Task request", blurb: "Ask someone to take this on — they can accept or pass it along",
                  icon: UserCheck, bg: "#FDF3E3", color: "#B45309", posted: "Task request sent" },
  poll:         { label: "Poll", blurb: "Let people vote between options",
                  icon: BarChart2, bg: "#EEE9FD", color: "#291D52", posted: "Poll posted" },
  accomplished: { label: "Task accomplished", blurb: "Mark work as done and show it off",
                  icon: PartyPopper, bg: "#F2FADF", color: "#3F6212", posted: "Nice — logged as accomplished" },
};

/* Who a calendar mark is aimed at (tasks.mark_scope). */
const MARK_SCOPE_META = {
  self:   { label: "Just me" },
  member: { label: "A specific person" },
  group:  { label: "A group" },
  team:   { label: "Everyone" },
};

/* ============================================================================
 * APP TOUR — a first-run onboarding carousel, not a DOM-spotlight tour.
 * Deliberately content-only (no getBoundingClientRect/positioning against
 * real nav elements): a spotlight tour that highlights actual buttons is
 * fragile the moment the sidebar collapses on mobile or anything shifts a
 * few pixels, and this content ships without the ability to visually check
 * it against a live layout. A slide deck degrades gracefully instead — it's
 * always just a centered card regardless of viewport.
 * ==========================================================================*/
const TOUR_STEPS = [
  { icon: Layers, mesh: THEME_PRESETS[0].mesh, title: "Welcome to Puroductive",
    body: "A cross-company task supervisor that acts like a strict coach — miss a deadline and it shows, finish on time and it celebrates. Everything lives inside a workspace: your Personal one is private, and you can create Team workspaces to actually collaborate. This is a quick tour of where everything is." },
  { icon: LayoutGrid, mesh: THEME_PRESETS[0].mesh, title: "Dashboard — the sand stack",
    body: "Every project fills a “sand stack” as weighted tasks get completed. Miss a deadline and the stack turns moldy — literally — until you catch up. Blunt on purpose: one glance tells you what's actually on track." },
  { icon: FolderKanban, mesh: THEME_PRESETS[1].mesh, title: "Projects & tasks",
    body: "Tasks move through a strict state machine — pending, in progress, completed, or overdue → retry. An overdue task can't just be marked done: it forces a permanent “what went wrong” reflection first. Tasks can be individual or team-owned, and any task can be marked to stand out on the calendar." },
  { icon: Building2, mesh: THEME_PRESETS[2].mesh, title: "Companies, Team & People",
    body: "Companies and Team are your roster — names you can assign work to, no account needed. People & access is different: who can actually sign into this workspace, with roles from Viewer up to Owner. Invite someone by email and they get a real notification to accept, not a silent auto-join." },
  { icon: MessageSquare, mesh: THEME_PRESETS[3].mesh, title: "The Board",
    body: "Share a photo or an update and pick what you want back: ask “what are your thoughts,” send a task request someone can accept or pass along (either way, permanently logged), run a poll, or post something as accomplished." },
  { icon: Bell, mesh: THEME_PRESETS[4].mesh, title: "Notifications",
    body: "The bell in the sidebar holds things that need your attention — pending invites and anything else worth coming back to. Unlike a toast, these stick around until you deal with them. Tap one to jump straight to what it's about, or swipe it away." },
  { icon: Trophy, mesh: THEME_PRESETS[0].mesh, title: "The leaderboard",
    body: "Completing tasks earns points — on time is worth double late. Nothing here is a separate score to game, it's the same task data as everywhere else in the app, just ranked. Streaks reward consecutive on-time days." },
  { icon: MessageCircle, mesh: THEME_PRESETS[1].mesh, title: "Chat",
    body: "General is everyone in the workspace. Every group you set up under Team gets its own channel automatically — no separate setup needed." },
  { icon: CalendarDays, mesh: THEME_PRESETS[3].mesh, title: "Calendar",
    body: "Today is always highlighted. Mark holidays, travel, or leave — leave asks for a reason, so month-end reporting can break it down — and connect Google Calendar for two-way sync: create an event here, it shows up there, and back." },
  { icon: BarChart3, mesh: THEME_PRESETS[2].mesh, title: "Reports, Gantt & the rest",
    body: "Reports compares you against your own best month, nobody else's. Gantt gives you the timeline view across projects. And the sun/moon icon near your name switches the whole app to dark mode, any time. That's the tour — reopen it later from the ? next to the notification bell." },
];

const AppTour = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const isMobile = useIsMobile();
  const cur = TOUR_STEPS[step];
  const Icon = cur.icon;
  const last = step === TOUR_STEPS.length - 1;

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, background: "rgba(22,24,29,0.4)", backdropFilter: "blur(6px)" }}>
      <div className="pd-pop-in" style={{
        width: "100%", maxWidth: isMobile ? "100%" : 440, borderRadius: 22, background: T.card,
        border: `1px solid ${T.line}`, boxShadow: T.shadowLg, overflow: "hidden",
      }}>
        <Mesh mesh={cur.mesh} style={{ padding: "30px 28px 22px" }}>
          <button onClick={onClose} aria-label="Skip tour" className="pd-press" style={{
            position: "absolute", top: 16, right: 16, width: 30, height: 30, borderRadius: 9,
            background: "rgba(255,255,255,0.55)", border: "none", cursor: "pointer",
            display: "grid", placeItems: "center", color: "#16181D",
          }}><X size={14} /></button>
          <div style={{ width: 46, height: 46, borderRadius: 13, display: "grid", placeItems: "center",
            background: "rgba(255,255,255,0.55)", marginBottom: 14 }}>
            <Icon size={22} style={{ color: "#16181D" }} />
          </div>
          <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 19, fontWeight: 700, color: "#16181D", letterSpacing: "-0.02em" }}>
            {cur.title}
          </h2>
        </Mesh>
        <div style={{ padding: "22px 28px 26px" }}>
          <p style={{ margin: 0, fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>{cur.body}</p>

          <div style={{ display: "flex", justifyContent: "center", gap: 5, margin: "20px 0" }}>
            {TOUR_STEPS.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 16 : 6, height: 6, borderRadius: 99, transition: "width 200ms ease-out",
                background: i === step ? T.limeDeep : T.lineSoft,
              }} />
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <button onClick={onClose} className="pd-press" style={{
              background: "none", border: "none", cursor: "pointer", fontSize: 12, color: T.ink3, padding: "8px 4px",
            }}>Skip tour</button>
            <div style={{ display: "flex", gap: 8 }}>
              {step > 0 && <Btn small ghost onClick={() => setStep((s) => s - 1)}>Back</Btn>}
              {last
                ? <Btn small onClick={onClose}><Check size={13} /> Get started</Btn>
                : <Btn small onClick={() => setStep((s) => s + 1)}>Next <ChevronRight size={13} /></Btn>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* A little variety so an on-time completion doesn't say the exact same
 * thing every time — small, cheap piece of the "playful" ask. */
const CELEBRATION_MESSAGES = [
  "Nice — task done", "Sand stack rising", "One down, on time",
  "Clean finish", "That's the way", "Momentum builds",
];

/* ---------------- engine reducer: tasks + immutable logs ------------------
 * Pure and exhaustively guarded: illegal transitions are structural no-ops,
 * reflections are append-only, and the only delete path refuses anything
 * that is not completed. */
export function engineReducer(s, a) {
  const log = (t, from, to, event, note) => ({
    id: uid(), taskId: t.id, from, to, event, note: note ?? null, at: new Date().toISOString(),
  });

  switch (a.type) {
    /* Hydrate from Supabase on load. Interventions aren't stored — they're
     * re-derived for any already-overdue task that has no logged reflection. */
    case "INIT": {
      const interventions = a.tasks
        .filter((t) => t.state === "overdue" && !a.reflections.some((r) => r.taskId === t.id))
        .map((t) => ({ taskId: t.id }));
      return { tasks: a.tasks, transitions: a.transitions, reflections: a.reflections, handoffs: a.handoffs, interventions };
    }
    case "TRANSITION": {
      const t = s.tasks.find((x) => x.id === a.taskId);
      const next = t && TRANSITIONS[t.state][a.event];
      if (!next) return s; // defensive: illegal transitions are no-ops

      let handoffs = s.handoffs;
      let interventions = s.interventions;
      const patch = { state: next };

      /* Per-task duration (item 2) — self-contained on this one task, never
       * touching any other task's numbers. START stamps when the clock
       * starts; leaving in_progress by any path (PAUSE, COMPLETE, a failed
       * attempt, or a deadline sweep) folds whatever ran since then into
       * the accumulated total and stops the clock, so pausing and resuming
       * (possibly more than once) still adds up to one honest total. */
      if (a.event === "START") patch.startedAt = new Date().toISOString();
      if (t.state === "in_progress" && t.startedAt) {
        const ranMinutes = Math.round((Date.now() - new Date(t.startedAt).getTime()) / 60000);
        patch.activeMinutes = (t.activeMinutes ?? 0) + Math.max(0, ranMinutes);
        patch.startedAt = null;
      }
      if (a.event === "FAIL_ATTEMPT") patch.retryCount = t.retryCount + 1;
      if (a.event === "REASSIGN") {
        if (!a.toAssigneeId) return s; // guard: handoff must carry a target
        patch.assigneeId = a.toAssigneeId;
        if (a.newDeadline) patch.deadline = a.newDeadline;
        handoffs = [...handoffs, {
          id: uid(), taskId: t.id, fromAssigneeId: t.assigneeId, toAssigneeId: a.toAssigneeId,
          reason: a.reason || "Reassigned after failed attempt", status: "pending", at: new Date().toISOString(),
        }];
      }
      if (a.event === "RESCHEDULE" && a.newDeadline) patch.deadline = a.newDeadline;
      if (a.event === "COMPLETE") {
        // GUARD (Strict Supervisor): an overdue task cannot complete without a
        // permanently logged reflection. Re-queue the intervention instead.
        if (t.state === "overdue" && !s.reflections.some((r) => r.taskId === t.id)) {
          const queued = interventions.some((i) => i.taskId === t.id);
          return queued ? s : { ...s, interventions: [...interventions, { taskId: t.id }] };
        }
        patch.completedAt = new Date().toISOString();
        patch.completedLate = t.state === "overdue";
        // Completion answers "Has [assignee] completed the follow-up?" → close handoffs.
        handoffs = handoffs.map((h) => (h.taskId === t.id && h.status === "pending" ? { ...h, status: "completed" } : h));
        interventions = interventions.filter((i) => i.taskId !== t.id);
      }
      if (a.event === "DEADLINE_PASSED") {
        // Queue the non-dismissible intervention exactly once per unreflected miss.
        const hasReflection = s.reflections.some((r) => r.taskId === t.id);
        const queued = interventions.some((i) => i.taskId === t.id);
        if (!hasReflection && !queued) interventions = [...interventions, { taskId: t.id }];
      }

      return {
        ...s,
        tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)),
        transitions: [...s.transitions, log(t, t.state, next, a.event, a.note)],
        handoffs, interventions,
      };
    }

    /* Deadline sweep — DEADLINE_PASSED for every open task past its deadline. */
    case "SWEEP": {
      let out = s;
      for (const t of s.tasks) {
        if (["pending", "in_progress", "retry_pending"].includes(t.state) && isPast(t.deadline)) {
          out = engineReducer(out, { type: "TRANSITION", taskId: t.id, event: "DEADLINE_PASSED", note: `Auto-sweep: deadline ${t.deadline} passed` });
        }
      }
      return out;
    }

    /* Append-only. Reflections are never edited or removed — mirrors the DB
     * triggers of Phase 1. Submitting clears the intervention lock. */
    case "SUBMIT_REFLECTION": {
      const ok = ["whatWentWrong", "rootBottleneck", "correctiveAction"]
        .every((k) => a.answers?.[k] && a.answers[k].trim().length > 0);
      if (!ok) return s; // all three fields are mandatory
      return {
        ...s,
        reflections: [...s.reflections, {
          id: uid(), taskId: a.taskId, projectId: a.projectId,
          whatWentWrong: a.answers.whatWentWrong.trim(),
          rootBottleneck: a.answers.rootBottleneck.trim(),
          correctiveAction: a.answers.correctiveAction.trim(),
          at: new Date().toISOString(),
        }],
        interventions: s.interventions.filter((i) => i.taskId !== a.taskId),
      };
    }

    case "ADD_TASK":
      return { ...s, tasks: [...s.tasks, a.task] };

    /* Calendar marking (see MARK_SCOPE_META). Deliberately outside the
     * TRANSITIONS table: marking is a display flag, not a lifecycle event, so
     * it must never consume a state-machine edge or write a transition log. */
    case "MARK_TASK":
      return {
        ...s,
        tasks: s.tasks.map((x) => (x.id === a.taskId
          ? { ...x, isMarked: a.isMarked, markLabel: a.markLabel ?? "",
              markScope: a.markScope ?? null, markTargetId: a.markTargetId ?? null }
          : x)),
      };

    /* Drag-reorder (item 2). Also outside TRANSITIONS — like MARK_TASK, this
     * is a position, not a lifecycle event, and must never write a
     * transition log or touch state. Either field may be omitted. */
    case "SET_QUEUE_ORDER":
      return {
        ...s,
        tasks: s.tasks.map((x) => (x.id === a.taskId
          ? {
              ...x,
              ...(a.queueOrder !== undefined ? { queueOrder: a.queueOrder } : {}),
              ...(a.personalQueueOrder !== undefined ? { personalQueueOrder: a.personalQueueOrder } : {}),
            }
          : x)),
      };

    /* The optional completion photo (item 3) — a side-channel field, same
     * reasoning as SET_QUEUE_ORDER: not a lifecycle event, no transition log. */
    case "SET_TASK_PHOTO":
      return { ...s, tasks: s.tasks.map((x) => (x.id === a.taskId ? { ...x, completionPhotoPath: a.path } : x)) };

    /* The ONLY delete path — and it refuses anything not completed. */
    case "ARCHIVE_COMPLETED_TASK": {
      const t = s.tasks.find((x) => x.id === a.taskId);
      if (!t || t.state !== "completed") return s;
      return { ...s, tasks: s.tasks.filter((x) => x.id !== a.taskId) };
    }
    default:
      return s;
  }
}

/* ============================================================================
 * ENGINE 2 — SAND STACK (ported from core/engines/sandStack)
 * ==========================================================================*/
export function computeSandStack(project, tasks) {
  const totalWeight = tasks.reduce((n, t) => n + t.weight, 0);
  const completedWeight = tasks.filter((t) => t.state === "completed").reduce((n, t) => n + t.weight, 0);
  const headroom = 100 - project.baseline;
  const earned = totalWeight === 0 ? 0 : (completedWeight / totalWeight) * headroom;
  const fillPercent = Math.min(100, Math.max(0, project.baseline + earned));
  const degradationSources = tasks.filter((t) => t.state === "overdue").map((t) => t.id);
  return { fillPercent, degraded: degradationSources.length > 0, degradationSources, totalWeight, completedWeight };
}

/* ============================================================================
 * ENGINE 5 — ALARM / REMINDER SERVICE (native device sound hooks)
 * Web build: WebAudio two-tone chime + the Web Notifications API.
 * Native builds swap ONE adapter behind the same interface:
 *   · Android (Capacitor): LocalNotifications.schedule({ sound: 'alarm.wav', … })
 *   · Desktop (Electron/Tauri): system Notification + shell beep
 * ==========================================================================*/
export const AlarmService = {
  granted: false,
  async requestPermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") { this.granted = true; return true; }
    try { this.granted = (await Notification.requestPermission()) === "granted"; } catch { this.granted = false; }
    return this.granted;
  },
  /** The "device sound": a crisp two-tone chime synthesised via WebAudio. */
  chime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const ping = (freq, t0, dur = 0.3) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
        g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
        o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur + 0.05);
      };
      ping(880, 0); ping(1318.5, 0.16);
    } catch { /* audio unavailable — notification text still shows */ }
  },
  notify(title, body) {
    this.chime();
    if (this.granted && typeof Notification !== "undefined") {
      try { new Notification(title, { body }); } catch { /* fall back to chime only */ }
    }
  },
  /** Reminder predicate: open task whose deadline lands within `hours`. */
  dueWithinHours(task, hours = 24) {
    if (!task.deadline || task.state === "completed") return false;
    const dt = new Date(task.deadline + "T18:00:00").getTime() - Date.now();
    return dt > 0 && dt < hours * 3600e3;
  },
};

/* ============================================================================
 * ENGINE 6 — CALENDAR & MONTHLY PRODUCTIVITY MATH (pure, testable)
 * Absolute hours from clock-in/out sessions, execution velocity from
 * completed task weight, and the Productivity Interruption/Loss factor from
 * holiday/travel days over the month's working days (Sundays excluded).
 * ==========================================================================*/
export const ymdOf = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export function monthWindow(offset = 0) {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const end = new Date(n.getFullYear(), n.getMonth() + offset + 1, 1);
  return { start, end, label: start.toLocaleString("en", { month: "long", year: "numeric" }) };
}
export function computeMonthlyStats({ sessions, tasks, exceptions }, offset = 0) {
  const { start, end, label } = monthWindow(offset);
  const inWin = (iso) => { const t = new Date(iso).getTime(); return t >= start.getTime() && t < end.getTime(); };

  // Absolute hours worked (an open session counts up to "now").
  let ms = 0;
  for (const s of sessions) {
    if (!inWin(s.loginAt)) continue;
    const out = s.logoutAt ? new Date(s.logoutAt) : new Date();
    ms += Math.max(0, out - new Date(s.loginAt));
  }
  const hours = ms / 3600e3;

  const done = tasks.filter((t) => t.completedAt && inWin(t.completedAt));
  const weightDone = done.reduce((n, t) => n + t.weight, 0);
  const late = done.filter((t) => t.completedLate).length;

  /* Working days = Mon–Sat inside the window. Every exception costs a day, but
   * the two families are counted apart: holiday/travel are days the calendar
   * took away, leave is a day a person chose to take. Both reduce capacity —
   * which is why lossFactor sums them — but a month with 8 leave days and a
   * month with 8 travel days are very different management problems, so the
   * report needs them separable. */
  let workingDays = 0, interruptionDays = 0, leaveDays = 0;
  const leaveEntries = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    workingDays++;
    const ymd = ymdOf(d);
    const onDay = exceptions.filter((x) => x.date === ymd);
    if (!onDay.length) continue;
    if (onDay.some((x) => isLeaveType(x.type))) {
      leaveDays++;
      for (const x of onDay.filter((e) => isLeaveType(e.type))) leaveEntries.push(x);
    } else {
      interruptionDays++;
    }
  }
  const lossDays = interruptionDays + leaveDays;
  const lossFactor = workingDays ? lossDays / workingDays : 0;
  const weeks = Math.max(1, (end - start) / (7 * 864e5));
  const velocity = weightDone / weeks; // execution velocity: weight / week

  /* Leave grouped by the stated reason — the month-end answer to "how many
   * days off, and what for". Unstated reasons collapse into one bucket rather
   * than being dropped, so nothing goes missing from the totals.
   *
   * These are PERSON-days, not calendar days: two people on leave the same
   * Tuesday is one leaveDay (the calendar lost one day) but two person-days
   * (the team lost two). Summing the rows below will therefore exceed
   * leaveDays on any day more than one person was out, which is correct —
   * they answer different questions and are labelled separately in the UI. */
  const byReason = new Map();
  for (const x of leaveEntries) {
    const key = (x.reason || "").trim() || "No reason given";
    const cur = byReason.get(key) ?? { reason: key, personDays: 0, declared: 0, taken: 0 };
    cur.personDays++;
    if (x.type === "leave_declared") cur.declared++; else cur.taken++;
    byReason.set(key, cur);
  }
  const leaveByReason = [...byReason.values()].sort((a, b) => b.personDays - a.personDays);
  const leavePersonDays = leaveEntries.length;

  // Weekly buckets for the chart (days 1-7, 8-14, 15-21, 22-28, 29+).
  const buckets = [0, 0, 0, 0, 0];
  for (const t of done) {
    buckets[Math.min(4, Math.floor((new Date(t.completedAt).getDate() - 1) / 7))] += t.weight;
  }
  return {
    label, hours, tasksDone: done.length, weightDone, late,
    workingDays, lossDays, lossFactor, velocity, buckets,
    interruptionDays, leaveDays, leaveByReason, leavePersonDays,
  };
}

/* Best-ever month by execution velocity, scanning back from the current
 * month. Skips months with zero activity so an idle stretch never poses as
 * "the bar to beat" — this is the "personal best" self-competition target,
 * one level up from computeMonthlyStats' single-month-vs-previous-month. */
export function computeAllTimeBest({ sessions, tasks, exceptions }, monthsBack = 24) {
  let best = null;
  for (let o = 0; o >= -monthsBack; o--) {
    const stats = computeMonthlyStats({ sessions, tasks, exceptions }, o);
    if (stats.tasksDone === 0 && stats.hours === 0) continue;
    if (!best || stats.velocity > best.velocity) best = { ...stats, offset: o };
  }
  return best;
}

/* Due / overdue / on-time / early / late breakdown for a set of tasks, plus
 * an overall completion-weighted productivity percentage. Pure and
 * scope-agnostic — callers pass whatever task slice they want (a project,
 * a company, or everything), and since it just reads the live task list it
 * updates instantly wherever it's called, no separate "refresh" needed. */
export function computeProductivityBreakdown(tasks) {
  const open = tasks.filter((t) => t.state !== "completed");
  const overdue = open.filter((t) => t.state === "overdue");
  const due = open.filter((t) => t.state !== "overdue"); // pending / in_progress / retry_pending
  const completed = tasks.filter((t) => t.state === "completed");
  const late = completed.filter((t) => t.completedLate);
  const onTime = completed.filter((t) => !t.completedLate);
  const early = onTime.filter((t) => t.deadline && t.completedAt && ymdOf(new Date(t.completedAt)) < t.deadline);
  const totalWeight = tasks.reduce((n, t) => n + t.weight, 0);
  const completedWeight = completed.reduce((n, t) => n + t.weight, 0);
  return {
    due, overdue, onTime, early, late, completed,
    totalWeight, completedWeight,
    overallProductivity: totalWeight ? Math.round((completedWeight / totalWeight) * 100) : 0,
  };
}

/* ============================================================================
 * ENGINE 8 — GAMIFICATION (pure, derived entirely from existing task data)
 *
 * "Feel like a game, but leading it requires being productive." Rather than
 * a separate points ledger (its own table, its own migration, its own way
 * to drift out of sync with what actually happened), points are computed
 * straight off the same completed-task records the rest of the app already
 * reads — a task's weight and whether it was completed late are already
 * tracked, so a leaderboard is just a different lens on data that exists,
 * not a new source of truth to keep consistent with the real one.
 * ==========================================================================*/

/* Late completion earns weight × 5, on-time earns weight × 10 — the whole
 * mechanic is one line: being on time is worth double, so ranking well
 * requires the actual thing this app is for, not just closing tickets. */
export function pointsForTask(t) {
  if (t.state !== "completed") return 0;
  return t.weight * (t.completedLate ? 5 : 10);
}

/* One row per member, individually-assigned completions only — a
 * team-scoped task has no single assignee to credit, and splitting its
 * points across a group's membership gets arbitrary fast (who was actually
 * on it?). Team output is already visible in the project's own sand stack;
 * this is deliberately the individual half of the picture. */
export function computeLeaderboard(tasks, members, sinceIso = null) {
  const inWindow = (iso) => !sinceIso || new Date(iso) >= new Date(sinceIso);
  const rows = new Map(members.map((m) => [m.id, {
    member: m, points: 0, tasksDone: 0, onTime: 0, late: 0, weightDone: 0,
  }]));
  for (const t of tasks) {
    if (t.state !== "completed" || !t.assigneeId || !t.completedAt || !inWindow(t.completedAt)) continue;
    const row = rows.get(t.assigneeId);
    if (!row) continue;
    row.points += pointsForTask(t);
    row.tasksDone++;
    row.weightDone += t.weight;
    if (t.completedLate) row.late++; else row.onTime++;
  }
  return [...rows.values()].sort((a, b) => b.points - a.points);
}

/* Consecutive days, counting back from today, with at least one on-time
 * completion — a late completion breaks it, same "on time is what counts"
 * rule as the points themselves. */
export function computeStreak(tasks, memberId) {
  const onTimeDays = new Set(
    tasks
      .filter((t) => t.assigneeId === memberId && t.state === "completed" && !t.completedLate && t.completedAt)
      .map((t) => ymdOf(new Date(t.completedAt)))
  );
  let streak = 0;
  const d = new Date();
  while (onTimeDays.has(ymdOf(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

export const LEVEL_TIERS = [
  { min: 0,    label: "Getting Started",  color: "#8A8F99" },
  { min: 150,  label: "Building Momentum", color: "#0284C7" },
  { min: 500,  label: "On a Roll",         color: "#7CB518" },
  { min: 1200, label: "Top Performer",     color: "#D97706" },
  { min: 2500, label: "Legend",            color: "#7C5CDB" },
];
export function levelForPoints(points) {
  let level = LEVEL_TIERS[0];
  for (const tier of LEVEL_TIERS) { if (points >= tier.min) level = tier; }
  const idx = LEVEL_TIERS.indexOf(level);
  const next = LEVEL_TIERS[idx + 1] ?? null;
  return { ...level, next, toNext: next ? next.min - points : 0 };
}

/* ============================================================================
 * TASK QUEUES (item 2, schema_v9) — two independent fractional orderings:
 * queue_order (a project's own pipeline) and personal_queue_order (an
 * assignee's cross-project queue). Both are plain floats, so inserting
 * between two neighbors is just averaging their order values — see
 * nextQueueOrder/betweenQueueOrder below, used by drag-reorder and by new
 * tasks joining the tail of both queues automatically.
 * ==========================================================================*/
export function nextQueueOrder(existingOrders) {
  const max = existingOrders.length ? Math.max(...existingOrders) : 0;
  return max + 1000;
}
export function betweenQueueOrder(prevOrder, nextOrder) {
  if (prevOrder == null) return nextOrder == null ? 1000 : nextOrder / 2;
  if (nextOrder == null) return prevOrder + 1000;
  return (prevOrder + nextOrder) / 2;
}
/* Resolves the single task that should auto-start once `completed` finishes
 * — personal queue wins over project queue when a task sits in both (so
 * "MY workflow" takes precedence), and at most one task is ever returned. */
export function findNextQueuedTask(tasks, completed) {
  if (completed.assigneeId && completed.personalQueueOrder != null) {
    const candidates = tasks.filter((x) =>
      x.assigneeId === completed.assigneeId && x.state === "pending" &&
      x.personalQueueOrder != null && x.personalQueueOrder > completed.personalQueueOrder);
    if (candidates.length) {
      return candidates.reduce((a, b) => (a.personalQueueOrder < b.personalQueueOrder ? a : b));
    }
  }
  if (completed.queueOrder != null) {
    const candidates = tasks.filter((x) =>
      x.projectId === completed.projectId && x.state === "pending" &&
      x.queueOrder != null && x.queueOrder > completed.queueOrder);
    if (candidates.length) {
      return candidates.reduce((a, b) => (a.queueOrder < b.queueOrder ? a : b));
    }
  }
  return null;
}

/* Open (non-completed) tasks whose deadline falls on this YYYY-MM-DD. */
export function tasksDueOn(tasks, ymd) {
  return tasks.filter((t) => t.deadline === ymd && t.state !== "completed");
}
/* Active projects whose deadline falls on this YYYY-MM-DD. */
export function projectDeadlinesOn(projects, ymd) {
  return projects.filter((p) => p.deadline === ymd && p.status === "active");
}
/* Merges manual events + open task deadlines + active project deadlines into
 * one date-sorted agenda, for both the day-grid dots and the Upcoming panel. */
export function buildAgenda({ events, tasks, projects }, days = 14) {
  const today = ymdOf(new Date());
  const horizon = ymdOf(new Date(Date.now() + days * 864e5));
  const inWindow = (ymd) => ymd >= today && ymd <= horizon;
  const items = [];
  for (const e of events) {
    if (inWindow(e.date)) items.push({ kind: "event", date: e.date, id: e.id, ref: e });
  }
  for (const t of tasks) {
    if (t.deadline && t.state !== "completed" && inWindow(t.deadline)) items.push({ kind: "task", date: t.deadline, id: t.id, ref: t });
  }
  for (const p of projects) {
    if (p.deadline && p.status === "active" && inWindow(p.deadline)) items.push({ kind: "project", date: p.deadline, id: p.id, ref: p });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items;
}
/* Human-readable "who is this task for". A team task names its group; an
 * individual task names the person. Both fall back to a legible label rather
 * than an empty string, since this renders inline in task rows. */
export function taskAudience(task, members, groups = []) {
  if (task.scope === "team") {
    const g = groups.find((x) => x.id === task.assigneeGroupId);
    return g ? `${g.name} (team)` : "Whole team";
  }
  return members.find((m) => m.id === task.assigneeId)?.name ?? "Unassigned";
}

export function relativeDayLabel(ymd) {
  const today = ymdOf(new Date());
  if (ymd === today) return "Today";
  if (ymd === ymdOf(new Date(Date.now() + 864e5))) return "Tomorrow";
  const days = Math.round((new Date(ymd) - new Date(today)) / 864e5);
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/* ============================================================================
 * ENGINE 7 — EXPORT & ANALYTICS (Word/Docx-ready report compiler)
 * compileProjectReport() → { report, docHtml }
 *   · report  — the full structured object (timelines, reflections,
 *               attachment links) for the real Phase-1 docx pipeline
 *   · docHtml — Word-compatible HTML; saved as .doc it opens directly in
 *               MS Word with headings, tables, and the reflection log intact
 * ==========================================================================*/
export function compileProjectReport({ project, company, tasks, transitions, reflections, members, board }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? "Unassigned";
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const stack = computeSandStack(project, tasks);
  const breakdown = computeProductivityBreakdown(tasks);

  const report = {
    format: "puroductive-project-report",
    generatedAt: new Date().toISOString(),
    company: { name: company?.name, industry: company?.industry, location: company?.location },
    project: { name: project.name, type: project.type, baselinePercent: project.baseline, deadline: project.deadline, deadlineLocked: !!project.locked },
    sandStack: { fillPercent: Math.round(stack.fillPercent), degraded: stack.degraded, completedWeight: stack.completedWeight, totalWeight: stack.totalWeight },
    productivity: {
      due: breakdown.due.length, overdue: breakdown.overdue.length,
      onTime: breakdown.onTime.length, early: breakdown.early.length, late: breakdown.late.length,
      overallProductivity: Math.round(stack.fillPercent),
    },
    tasks: tasks.map((t) => ({
      title: t.title, state: t.state, assignee: nameOf(t.assigneeId),
      deadline: t.deadline, completedAt: t.completedAt, completedLate: !!t.completedLate,
      retryCount: t.retryCount, weight: t.weight,
      timeline: transitions.filter((x) => x.taskId === t.id)
        .map((x) => ({ at: x.at, event: x.event, from: x.from, to: x.to, note: x.note })),
      attachmentLinks: (t.attachments ?? []).map((a) => (typeof a === "string" ? a : a.url)),
    })),
    reflectionLog: reflections.filter((r) => r.projectId === project.id).map((r) => ({
      at: r.at, task: tasks.find((t) => t.id === r.taskId)?.title ?? "Task",
      whatWentWrong: r.whatWentWrong, rootBottleneck: r.rootBottleneck, correctiveAction: r.correctiveAction,
    })),
    /* Board task requests touching this project, with every decline and
     * transfer they went through. This is what makes "whenever a report is
     * generated that task has a paper trail" true rather than aspirational —
     * a task that four people passed on reads very differently from one
     * somebody picked up immediately. */
    requestTrail: (board?.requests ?? [])
      .filter((r) => r.projectId === project.id || tasks.some((t) => t.id === r.taskId))
      .map((r) => ({
        title: r.title, status: r.status, assignee: nameOf(r.assigneeMemberId),
        events: (board?.requestEvents ?? [])
          .filter((e) => e.requestId === r.id)
          .map((e) => ({
            at: e.at, action: e.action, reason: e.reason,
            from: e.fromMemberId ? nameOf(e.fromMemberId) : null,
            to: e.toMemberId ? nameOf(e.toMemberId) : null,
          })),
      })),
  };

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const taskRows = report.tasks.map((t) => `
    <tr><td>${esc(t.title)}</td><td>${esc(t.state)}</td><td>${esc(t.assignee)}</td>
    <td>${esc(t.deadline ?? "—")}</td><td>${esc(fmt(t.completedAt))}${t.completedLate ? " <b>(late)</b>" : ""}</td>
    <td align="center">${t.retryCount}</td><td align="center">${t.weight}</td></tr>`).join("");
  const timelineBlocks = report.tasks.filter((t) => t.timeline.length).map((t) => `
    <h3>${esc(t.title)}</h3><ul>${t.timeline.map((e) =>
      `<li>${esc(fmt(e.at))} — <b>${esc(e.event)}</b>: ${esc(e.from)} → ${esc(e.to)}${e.note ? ` <i>(${esc(e.note)})</i>` : ""}</li>`).join("")}</ul>`).join("");
  const reflectionBlocks = report.reflectionLog.length
    ? report.reflectionLog.map((r) => `
      <table class="ref"><tr><td>
        <b>${esc(r.task)}</b> — ${esc(fmt(r.at))}<br/>
        <b>What went wrong:</b> ${esc(r.whatWentWrong)}<br/>
        <b>Root bottleneck:</b> ${esc(r.rootBottleneck)}<br/>
        <b>Corrective action:</b> ${esc(r.correctiveAction)}
      </td></tr></table>`).join("")
    : "<p><i>No missed deadlines — no interventions were required.</i></p>";
  const trailBlocks = report.requestTrail.length
    ? report.requestTrail.map((r) => `
      <h3>${esc(r.title)} — ${esc(r.status)}${r.assignee ? ` (currently ${esc(r.assignee)})` : ""}</h3>
      <ul>${r.events.map((e) => {
        const who = e.action === "transferred" ? `${esc(e.from ?? "—")} &rarr; ${esc(e.to ?? "—")}`
          : e.action === "declined" ? esc(e.from ?? "—")
          : esc(e.to ?? "—");
        return `<li>${esc(fmt(e.at))} — <b>${esc(e.action)}</b>: ${who}${e.reason ? ` <i>(&ldquo;${esc(e.reason)}&rdquo;)</i>` : ""}</li>`;
      }).join("")}</ul>`).join("")
    : "<p><i>No board task requests for this project.</i></p>";
  const attachmentBlocks = report.tasks.filter((t) => t.attachmentLinks.length).map((t) =>
    `<li><b>${esc(t.title)}</b>: ${t.attachmentLinks.map((u) => `<a href="${esc(u)}">${esc(u)}</a>`).join(", ")}</li>`).join("");

  // Classic Word-safe "bar chart": a fixed-width filled/empty table-cell pair
  // per row. Real SVG/canvas doesn't render reliably once opened as a .doc,
  // but table cells with inline background-color/width always do.
  const BAR_MAX_PX = 220;
  const productivityRows = [
    ["Due", breakdown.due.length, "#8A8F99"],
    ["Overdue", breakdown.overdue.length, "#B91C1C"],
    ["Completed on time", breakdown.onTime.length, "#3F6212"],
    ["Completed early", breakdown.early.length, "#7CB518"],
    ["Completed late", breakdown.late.length, "#D97706"],
  ];
  const productivityMax = Math.max(1, ...productivityRows.map(([, n]) => n));
  const productivityBlocks = productivityRows.map(([label, n, color]) => {
    const px = Math.round((n / productivityMax) * BAR_MAX_PX);
    return `<tr><td style="width:140pt;">${esc(label)}</td>
      <td style="width:24pt;" align="right"><b>${n}</b></td>
      <td><table cellpadding="0" cellspacing="0"><tr>
        <td style="width:${px}px;height:12px;background:${color};"></td>
        <td style="width:${BAR_MAX_PX - px}px;height:12px;background:#EFEFEA;"></td>
      </tr></table></td></tr>`;
  }).join("");

  const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(project.name)} — Project Report</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #16181D; }
  h1 { font-size: 24pt; letter-spacing: -0.5pt; margin-bottom: 2pt; }
  h2 { font-size: 14pt; border-bottom: 1.5pt solid #C6F04D; padding-bottom: 3pt; margin-top: 22pt; }
  h3 { font-size: 11pt; margin-bottom: 3pt; }
  .meta { color: #5A5F69; font-size: 10pt; }
  table.grid { border-collapse: collapse; width: 100%; font-size: 10pt; }
  table.grid td, table.grid th { border: 0.75pt solid #C9C9C2; padding: 5pt 7pt; }
  table.grid th { background: #F4FBE3; text-align: left; }
  table.ref { width: 100%; background: #FDF9EF; border: 0.75pt solid #EFE3C8; margin-bottom: 8pt; }
  table.ref td { padding: 8pt 10pt; font-size: 10pt; }
  table.prod td { padding: 4pt 6pt; font-size: 10pt; vertical-align: middle; }
</style></head><body>
<h1>${esc(project.name)}</h1>
<p class="meta">${esc(company?.name ?? "")} · ${esc(company?.location ?? "")} · Generated ${esc(fmt(report.generatedAt))}<br/>
Type: ${esc(project.type === "zero_to_one" ? "Zero → One" : `Ongoing (baseline ${project.baseline}%)`)} ·
Deadline: ${esc(project.deadline ?? "—")}${project.locked ? " (locked)" : ""} ·
Sand stack: <b>${report.sandStack.fillPercent}%</b>${report.sandStack.degraded ? " — DEGRADED" : ""}</p>
<h2>Productivity Breakdown</h2>
<p class="meta">Overall productivity: <b>${report.productivity.overallProductivity}%</b> of baseline-weighted work completed.</p>
<table class="prod">${productivityBlocks}</table>
<h2>Task Register</h2>
<table class="grid"><tr><th>Task</th><th>State</th><th>Assignee</th><th>Deadline</th><th>Completed</th><th>Retries</th><th>Weight</th></tr>${taskRows}</table>
<h2>Task Timelines</h2>${timelineBlocks || "<p><i>No transitions recorded yet.</i></p>"}
<h2>Supervisor Reflection Log (permanent)</h2>${reflectionBlocks}
<h2>Task Request Paper Trail</h2>
<p class="meta">Every hand-off a board task request went through, with the reason given. This record is append-only and cannot be edited after the fact.</p>
${trailBlocks}
<h2>Photo Verification — Attachment Links</h2>${attachmentBlocks ? `<ul>${attachmentBlocks}</ul>` : "<p><i>No attachments recorded.</i></p>"}
</body></html>`;

  return { report, docHtml };
}
export function downloadProjectDoc(compiled, filename) {
  const blob = new Blob(["\ufeff" + compiled.docHtml], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/* rows: array of arrays, first row is the header. Escapes quotes/commas per
 * RFC 4180 so titles/notes with commas don't break columns. */
export function downloadCsv(rows, filename) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Companies, projects, members, tasks, calendar exceptions and work sessions
 * are now loaded live from Supabase (see lib/db.js) — no seed data here. */

/* Reactive viewport check — each component that needs it calls this directly
 * rather than threading an isMobile prop down through the tree. */
function useIsMobile(breakpoint = 820) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}

/* ------------------------------ GLOBAL STYLES ----------------------------- */
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;450;500;600&display=swap');
    * { box-sizing: border-box; }
    /* body { background } lives in src/lib/theme.js's THEME_CSS instead —
     * that one mounts before sign-in too, this one doesn't. */
    /* Selection text stays a fixed dark color on purpose — it's always sat
     * on the bright lime highlight, in either theme, so it never needs to
     * flip. */
    ::selection { background: var(--lime); color: #16181D; }
    .pd-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .pd-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 8px; }
    .pd-num { font-variant-numeric: tabular-nums; }
    .pd-rise { transition: transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 240ms ease-out; will-change: transform; }
    .pd-rise:hover { transform: translateY(-2px); box-shadow: ${T.shadowLg}; }
    .pd-fade-in { animation: pdFade 320ms cubic-bezier(.22,1,.36,1) both; }
    .pd-pop-in  { animation: pdPop 240ms cubic-bezier(.22,1,.36,1) both; }
    .pd-sand-fill { transition: transform 700ms cubic-bezier(.22,1,.36,1); will-change: transform; }
    .pd-shake { animation: pdShake 420ms cubic-bezier(.36,.07,.19,.97); }
    @keyframes pdFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pdPop  { from { opacity: 0; transform: scale(.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes pdShake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); }
      30%, 50%, 70% { transform: translateX(-3px); } 40%, 60% { transform: translateX(3px); } }
    @keyframes pdToast { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    .pd-toast { animation: pdToast 240ms cubic-bezier(.22,1,.36,1) both; }
    /* Confetti skips prefers-reduced-motion at the JS level (fireCelebration
     * never sets the trigger at all), so no pieces exist to animate for that
     * case — nothing extra needed here. */
    @keyframes pdConfetti {
      0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
      100% { transform: translate(var(--pd-drift), 105vh) rotate(var(--pd-rot)); opacity: 0; }
    }
    /* Very slow, low-amplitude — reads as "slowly spreading" rather than an
     * obvious animation, which is the point: mold shouldn't visibly pulse,
     * it should just look faintly alive if you watch it a while. */
    @keyframes pdMoldCreep {
      0%, 100% { transform: scale(1); filter: saturate(1); }
      50% { transform: scale(1.035); filter: saturate(1.15); }
    }
    .pd-mold-creep { animation: pdMoldCreep 9s ease-in-out infinite; }
    .pd-msg-del { opacity: 0; transition: opacity 150ms; }
    .pd-msg-row:hover .pd-msg-del { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .pd-rise, .pd-press, .pd-fade-in, .pd-pop-in, .pd-sand-fill, .pd-shake, .pd-toast, .pd-mold-creep { animation: none !important; transition: none !important; }
      .pd-rise:hover { transform: none; }
    }
    input, select, textarea { font-family: inherit; color: inherit; }
    input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
      outline: 2px solid var(--lime-deep); outline-offset: 2px;
    }
    /* Playful, bouncier press than the flat scale(0.98) alone — a hint of
     * overshoot on release rather than a dead stop. */
    .pd-press { transition: transform 140ms cubic-bezier(.34,1.56,.64,1); }
    .pd-press:active { transform: scale(0.96); transition-duration: 60ms; }
  `}</style>
);

/* ------------------------- SAND MESH + GRAIN SURFACE ---------------------- */
const meshBackground = (mesh) => ({
  backgroundColor: mesh[1],
  backgroundImage: [
    `radial-gradient(120% 120% at 12% 8%, ${mesh[0]} 0%, transparent 55%)`,
    `radial-gradient(130% 130% at 92% 18%, ${mesh[1]} 0%, transparent 60%)`,
    `radial-gradient(140% 150% at 55% 110%, ${mesh[2]} 0%, transparent 62%)`,
  ].join(", "),
});
const GrainOverlay = ({ opacity = 0.28, radius = "inherit" }) => (
  <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: radius, pointerEvents: "none",
    backgroundImage: GRAIN, backgroundSize: "140px 140px", opacity, mixBlendMode: "overlay" }} />
);
const Mesh = ({ mesh, children, style = {}, className = "" }) => (
  <div className={className} style={{ position: "relative", overflow: "hidden", ...meshBackground(mesh), ...style }}>
    <GrainOverlay />
    <div style={{ position: "relative", height: "100%" }}>{children}</div>
  </div>
);

/* Real mold isn't a smooth two-stop gradient — it's blotchy, uneven, with
 * darker spore-clusters at irregular spots and an olive-black undertone
 * rather than flat gray. Fixed coordinates (not randomized per render) so it
 * doesn't jitter or reflow on re-render; it still reads as organic because
 * the positions themselves are irregular rather than symmetric. */
const MOLD_BLOTCHES = [
  { x: 10, y: 15, r: 46, c: "rgba(46,54,34,0.60)" },
  { x: 82, y: 10, r: 38, c: "rgba(34,42,26,0.50)" },
  { x: 58, y: 72, r: 55, c: "rgba(42,50,30,0.55)" },
  { x: 18, y: 85, r: 34, c: "rgba(28,35,20,0.45)" },
  { x: 92, y: 58, r: 40, c: "rgba(40,48,28,0.50)" },
  { x: 38, y: 42, r: 30, c: "rgba(52,60,40,0.35)" },
];
const moldBackground = () => ({
  backgroundColor: "#93968A",
  backgroundImage: MOLD_BLOTCHES.map((b) =>
    `radial-gradient(${b.r}% ${b.r}% at ${b.x}% ${b.y}%, ${b.c} 0%, transparent 68%)`
  ).join(", "),
});
/* The sand stack / bar widgets — full-strength blotches, grain, and a very
 * slow creep so the degraded state reads as something spreading rather than
 * a static gray fill. */
const MoldSurface = ({ children, style = {}, className = "" }) => (
  <div className={`pd-mold-creep ${className}`} style={{ position: "relative", overflow: "hidden", ...moldBackground(), ...style }}>
    <GrainOverlay opacity={0.4} />
    <div style={{ position: "relative", height: "100%" }}>{children}</div>
  </div>
);
/* The section-wide ambient wash — same texture, much fainter, sitting behind
 * an entire degraded project's page rather than being the focal element.
 * No z-index: same DOM-order trick Mesh/GrainOverlay already use elsewhere
 * in this file — an absolutely-positioned, z-index:auto div painted first,
 * with the real content following it in a position:relative wrapper, paints
 * underneath without needing to reason about stacking contexts. */
const MoldAmbient = () => (
  <div aria-hidden className="pd-mold-creep" style={{
    position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.16, ...moldBackground(),
  }} />
);

/* ============================================================================
 * SAND STACK VISUALS — grainy fill rises with completion; molds when degraded.
 * Fill animates via translateY/translateX (GPU) — never height/width.
 * ==========================================================================*/
const SandStackColumn = ({ stack, theme, height = 260 }) => {
  const pct = Math.round(stack.fillPercent);
  return (
    <div style={{ width: "100%" }}>
      <div style={{
        position: "relative", height, borderRadius: 18, overflow: "hidden",
        background: T.lineSoft, border: `1px solid ${T.line}`,
        boxShadow: "inset 0 2px 6px rgba(22,24,29,0.06)",
      }}>
        <div className="pd-sand-fill" style={{
          position: "absolute", inset: 0,
          transform: `translateY(${100 - stack.fillPercent}%)`,
        }}>
          {stack.degraded ? (
            <MoldSurface style={{ position: "absolute", inset: 0 }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: "rgba(255,255,255,0.5)", filter: "blur(1px)" }} />
            </MoldSurface>
          ) : (
            <Mesh mesh={theme.mesh} style={{ position: "absolute", inset: 0 }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: "rgba(255,255,255,0.5)", filter: "blur(1px)" }} />
            </Mesh>
          )}
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span className="pd-num" style={{
            fontFamily: T.fontDisplay, fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em",
            color: stack.fillPercent > 55 ? (stack.degraded ? MOLD_INK : theme.ink) : T.ink,
            textShadow: "0 1px 0 rgba(255,255,255,0.4)",
          }}>{pct}%</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
            color: stack.fillPercent > 45 ? (stack.degraded ? MOLD_INK : theme.ink) : T.ink3, opacity: 0.8 }}>
            {stack.degraded ? "Degraded" : "Sand stack"}
          </span>
        </div>
      </div>
      {stack.degraded && (
        <div className="pd-shake" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10,
          padding: "9px 12px", borderRadius: 11, background: T.dangerBg, border: `1px solid ${T.dangerLine}` }}>
          <Flame size={13} style={{ color: T.danger, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: T.danger, lineHeight: 1.45 }}>
            {stack.degradationSources.length} missed task{stack.degradationSources.length > 1 ? "s" : ""} molding the stack.
            Premium color returns only by completing them.
          </span>
        </div>
      )}
    </div>
  );
};

const SandBar = ({ stack, theme }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 130 }}>
    <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 99, overflow: "hidden",
      background: T.lineSoft, border: `1px solid ${T.lineSoft}` }}>
      <div className="pd-sand-fill" style={{ position: "absolute", inset: 0, transform: `translateX(${stack.fillPercent - 100}%)` }}>
        {stack.degraded
          ? <MoldSurface style={{ position: "absolute", inset: 0 }} />
          : <Mesh mesh={theme.mesh} style={{ position: "absolute", inset: 0 }} />}
      </div>
    </div>
    <span className="pd-num" style={{ fontSize: 11.5, fontWeight: 600, minWidth: 34, textAlign: "right",
      color: stack.degraded ? T.danger : T.ink2 }}>{Math.round(stack.fillPercent)}%</span>
  </div>
);

/* ------------------------------- PRIMITIVES ------------------------------- */
const Card = ({ children, className = "", style = {}, onClick, soft }) => (
  <div onClick={onClick} className={className} style={{
    position: "relative", borderRadius: 18, background: soft ? T.cardSoft : T.card,
    border: `1px solid ${T.line}`, boxShadow: T.shadowSm, ...style,
  }}>{children}</div>
);
const Btn = ({ children, onClick, ghost, danger, small, ink = false, type = "button", disabled }) => (
  <button type={type} onClick={onClick} disabled={disabled} className="pd-press"
    style={{
      position: "relative", overflow: "hidden",
      display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer",
      minHeight: small ? 34 : 44, padding: small ? "0 14px" : "0 20px", borderRadius: 12,
      fontFamily: T.fontBody, fontSize: small ? 12.5 : 13.5, fontWeight: 600,
      transition: "transform 120ms ease-out, box-shadow 160ms ease-out, background 150ms ease-out",
      opacity: disabled ? 0.45 : 1,
      ...(danger
        ? { background: T.dangerBg, color: T.danger, border: `1px solid ${T.dangerLine}` }
        : ghost
        ? { background: T.card, color: T.ink2, border: `1px solid ${T.line}`, boxShadow: T.shadowSm }
        : ink
        /* Literal, not T.ink — this is a fixed "always-dark surface, white
         * text" button style. T.ink flips to a LIGHT color in dark mode,
         * which would turn this into a light button with invisible white
         * text on it. */
        ? { background: "#16181D", color: "#FFFFFF", border: "none", boxShadow: T.shadowMd }
        /* item 4 — these six read from the per-workspace accent CSS vars
         * (applyAccent in lib/theme.js), not literals, so every primary
         * button in the app reflects whichever color a user picked for the
         * workspace they're currently in. Defaults to today's lime until
         * someone personalizes it. */
        : { color: "var(--lime-ink)", border: "1px solid color-mix(in srgb, var(--lime-deep) 12%, transparent)",
            boxShadow: "0 2px 6px color-mix(in srgb, var(--lime-deep) 25%, transparent), 0 10px 24px -10px color-mix(in srgb, var(--lime-deep) 50%, transparent)",
            ...meshBackground(["var(--lime-mesh-1)", "var(--lime-mesh-2)", "var(--lime-mesh-3)"]) }),
    }}>
    {!ghost && !danger && !ink && <GrainOverlay opacity={0.22} radius={12} />}
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>{children}</span>
  </button>
);
const Chip = ({ children, accent, bg, color }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999,
    fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
    color: color ?? (accent || T.ink2),
    background: bg ?? (accent ? `${accent}14` : T.cardSoft),
    border: `1px solid ${accent ? accent + "33" : T.line}`,
  }}>{children}</span>
);
const Label = ({ children }) => (
  <span style={{ display: "block", fontSize: 11, fontWeight: 600, letterSpacing: "0.09em",
    textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>{children}</span>
);
const inputStyle = {
  width: "100%", minHeight: 46, padding: "0 14px", borderRadius: 12, fontSize: 14,
  color: T.ink, background: T.card, border: `1px solid ${T.line}`,
  boxShadow: "inset 0 1px 2px rgba(22,24,29,0.03)",
};
const IconBtn = ({ children, onClick, label, danger }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label} className="pd-press" style={{
    width: 32, height: 32, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center",
    background: T.card, border: `1px solid ${T.line}`, boxShadow: T.shadowSm,
    color: danger ? T.danger : T.ink2, flexShrink: 0,
  }}>{children}</button>
);

/* Modal: dismissible by default; the Strict Supervisor uses locked={true} —
 * no close button, no ESC, no backdrop click. */
const Modal = ({ title, subtitle, onClose, children, wide, locked, tone }) => {
  const isMobile = useIsMobile();
  useEffect(() => {
    if (locked) return;
    const h = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, locked]);
  return (
    <div onClick={locked ? undefined : onClose} style={{
      position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: isMobile ? "flex-end" : "center",
      justifyContent: "center", padding: isMobile ? 0 : 20,
      background: locked ? "rgba(22,24,29,0.55)" : "rgba(22,24,29,0.32)", backdropFilter: "blur(6px)",
    }}>
      <div className="pd-pop-in pd-scroll" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{
        width: "100%", maxWidth: isMobile ? "100%" : wide ? 660 : 520, maxHeight: isMobile ? "92vh" : "90vh", overflowY: "auto",
        borderRadius: isMobile ? "22px 22px 0 0" : 22, background: T.card,
        border: tone === "danger" ? "1px solid #F3CFC6" : `1px solid ${T.line}`,
        boxShadow: T.shadowLg, padding: isMobile ? 18 : 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 20, fontWeight: 600, color: T.ink, letterSpacing: "-0.02em" }}>{title}</h2>
            {subtitle && <p style={{ margin: "5px 0 0", fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          {!locked && onClose && (
            <button onClick={onClose} aria-label="Close" className="pd-press" style={{
              width: 34, height: 34, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center",
              background: T.lineSoft, border: `1px solid ${T.line}`, color: T.ink2,
            }}><X size={15} /></button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
};

/* ============================================================================
 * ENGINE 3 — STRICT SUPERVISOR INTERVENTION (non-dismissible)
 * The only exit is a complete, three-part reflection — permanently appended.
 * ==========================================================================*/
const InterventionModal = ({ task, project, onSubmit }) => {
  const [a, setA] = useState({ whatWentWrong: "", rootBottleneck: "", correctiveAction: "" });
  const ready = Object.values(a).every((v) => v.trim().length >= 3);
  const Q = [
    { k: "whatWentWrong", q: "1 · What went wrong?", ph: "Describe exactly what failed…" },
    { k: "rootBottleneck", q: "2 · What was the root bottleneck?", ph: "The real underlying cause…" },
    { k: "correctiveAction", q: "3 · What is the immediate corrective action?", ph: "The concrete next step, with an owner…" },
  ];
  return (
    <Modal locked tone="danger" wide
      title="Deadline missed — supervisor intervention"
      subtitle="This alert cannot be dismissed. Complete the reflection to continue working.">
      <div style={{ display: "flex", gap: 12, padding: "13px 15px", borderRadius: 13, marginBottom: 20,
        background: T.dangerBg, border: `1px solid ${T.dangerLine}` }}>
        <Ban size={17} style={{ color: T.danger, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, lineHeight: 1.55, color: T.danger }}>
          <strong>{task.title}</strong> in <strong>{project?.name}</strong> passed its deadline
          ({task.deadline}). The sand stack is now degraded. This reflection is logged permanently
          into the final project report.
        </div>
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        {Q.map(({ k, q, ph }) => (
          <div key={k}>
            <Label>{q}</Label>
            <textarea rows={2} style={{ ...inputStyle, minHeight: 64, paddingTop: 11, resize: "vertical" }}
              value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} placeholder={ph} />
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: T.ink3, display: "flex", alignItems: "center", gap: 6 }}>
            <ScrollText size={12} /> Permanent · cannot be edited later
          </span>
          <Btn ink disabled={!ready} onClick={() => ready && onSubmit(a)}>
            <Check size={15} /> Log reflection & resume
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ============================================================================
 * ENGINE 4 — HANDOFF / RETRY LOOP UI
 * ==========================================================================*/
/* ----------------------- MEMBER PICKER (item 12) ---------------------------
 * A searchable, department-grouped alternative to a bare <select> or a long
 * unfiltered list of cards — used anywhere a task needs an assignee, so
 * finding the right person out of a big roster stops being a scroll hunt.
 * "Assign to me" is one click rather than searching for your own name. */
const MemberPickerList = ({ members, groups, companies, value, onChange, myMemberId,
  allowSelf = true, allowUnassigned = true, unassignedLabel = "Unassigned" }) => {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = members.filter((m) => !q || m.name.toLowerCase().includes(q) || m.roles.some((r) => r.toLowerCase().includes(q)));
  const groupName = (m) => groups.find((g) => g.id === m.groupId)?.name ?? "Ungrouped";
  const sorted = [...filtered].sort((a, b) => groupName(a).localeCompare(groupName(b)) || a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.ink3, pointerEvents: "none" }} />
          <input style={{ ...inputStyle, paddingLeft: 32, minHeight: 38 }} value={query}
            onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or role…" />
        </div>
        {allowSelf && myMemberId && (
          <Btn small ghost onClick={() => onChange(myMemberId)}><UserCheck size={13} /> Assign to me</Btn>
        )}
      </div>
      <div className="pd-scroll" style={{ display: "grid", gap: 7, maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
        {allowUnassigned && (
          <button type="button" onClick={() => onChange("")} className="pd-press" style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11,
            cursor: "pointer", textAlign: "left",
            background: !value ? "#F4FBE3" : T.card, border: `1px solid ${!value ? "#C9E88A" : T.line}`,
          }}>
            <span style={{ flex: 1, fontSize: 12.5, color: T.ink2 }}>{unassignedLabel}</span>
            {!value && <Check size={14} style={{ color: T.limeDeep }} />}
          </button>
        )}
        {sorted.map((m) => {
          const on = value === m.id;
          const co = companies.find((c) => c.id === m.companyIds[0]);
          return (
            <button type="button" key={m.id} onClick={() => onChange(m.id)} className="pd-press" style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11,
              cursor: "pointer", textAlign: "left",
              background: on ? "#F4FBE3" : T.card, border: `1px solid ${on ? "#C9E88A" : T.line}`,
            }}>
              <Mesh mesh={co?.theme.mesh ?? THEME_PRESETS[0].mesh} style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center",
                border: "1px solid rgba(22,24,29,0.07)",
              }}>
                <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 11, color: co?.theme.ink ?? "#243305" }}>{m.name[0]}</span>
              </Mesh>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {m.name}
                  {m.id === myMemberId && <Chip>You</Chip>}
                  {m.defaultDelegate && <Chip accent={T.limeDeep}><ShieldCheck size={9} /></Chip>}
                  {m.external && <Chip><Globe size={9} /></Chip>}
                </div>
                <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {groupName(m)}{m.roles.length ? ` · ${m.roles.join(", ")}` : ""}
                </div>
              </div>
              {on && <Check size={14} style={{ color: T.limeDeep, flexShrink: 0 }} />}
            </button>
          );
        })}
        {sorted.length === 0 && <span style={{ fontSize: 11.5, color: T.ink3, padding: "6px 4px" }}>No matches.</span>}
      </div>
    </div>
  );
};

const ReassignModal = ({ task, members, groups, companies, myMemberId, onConfirm, onClose }) => {
  const raj = members.find((m) => m.defaultDelegate);
  const [toId, setToId] = useState(raj?.id ?? members[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  return (
    <Modal title="Reassign task" wide onClose={onClose}
      subtitle="Tasks in retry are never dismissed — they are handed to someone in the pool and tracked until done.">
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Hand off to</Label>
          <MemberPickerList members={members} groups={groups} companies={companies}
            value={toId} onChange={setToId} myMemberId={myMemberId} allowUnassigned={false} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Reason</Label>
            <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={`e.g. "Vendor missed call ×${task.retryCount || 1}"`} /></div>
          <div><Label>New attempt deadline</Label>
            <input type="date" min={todayIso()} style={inputStyle} value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Back</Btn>
          <Btn disabled={!toId} onClick={() => onConfirm({ toAssigneeId: toId, reason, newDeadline: newDeadline || undefined })}>
            <UserCheck size={15} /> Confirm handoff
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

/* item 9/17 — the same reflective rigor an overdue task's completion already
 * demands (InterventionModal), applied to moving a still-open deadline:
 * what changed, how far it actually got, and what's different this time so
 * it holds. Logged permanently to deadline_extensions (schema already
 * provisioned this table and its RLS — this is the first thing to write to
 * it), independent of the RESCHEDULE state transition itself. */
const RescheduleModal = ({ task, onConfirm, onClose }) => {
  const [d, setD] = useState("");
  const [whatChanged, setWhatChanged] = useState("");
  const [progressSoFar, setProgressSoFar] = useState("");
  const [planToHold, setPlanToHold] = useState("");
  const ready = !!d && whatChanged.trim() && progressSoFar.trim() && planToHold.trim();
  return (
    <Modal title="Reschedule attempt" onClose={onClose}
      subtitle={`Currently due ${task.deadline || "—"} · same assignee, a fresh attempt window.`}>
      <div style={{ display: "grid", gap: 16 }}>
        <div><Label>New attempt deadline</Label>
          <input type="date" min={todayIso()} style={inputStyle} value={d} onChange={(e) => setD(e.target.value)} /></div>
        <div><Label>What changed since the original deadline?</Label>
          <textarea rows={2} style={{ ...inputStyle, minHeight: 60, paddingTop: 11, resize: "vertical" }}
            value={whatChanged} onChange={(e) => setWhatChanged(e.target.value)}
            placeholder="e.g. Vendor delayed the raw material delivery by a week" /></div>
        <div><Label>Progress so far</Label>
          <textarea rows={2} style={{ ...inputStyle, minHeight: 60, paddingTop: 11, resize: "vertical" }}
            value={progressSoFar} onChange={(e) => setProgressSoFar(e.target.value)}
            placeholder="What's actually done already" /></div>
        <div><Label>Plan to hold the new date</Label>
          <textarea rows={2} style={{ ...inputStyle, minHeight: 60, paddingTop: 11, resize: "vertical" }}
            value={planToHold} onChange={(e) => setPlanToHold(e.target.value)}
            placeholder="What's different this time so it doesn't slip again" /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Back</Btn>
          <Btn disabled={!ready} onClick={() => onConfirm({
            newDeadline: d, whatChanged: whatChanged.trim(), progressSoFar: progressSoFar.trim(), planToHold: planToHold.trim(),
          })}><CalendarClock size={15} /> Reschedule</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* Shown when the user tries to delete a task that is not completed. */
const NoDismissModal = ({ task, onRoute, onClose }) => (
  <Modal title="Tasks are never dismissed" tone="danger" onClose={onClose}
    subtitle="Deleting incomplete work is not a path this system offers.">
    <div style={{ display: "flex", gap: 12, padding: "13px 15px", borderRadius: 13, marginBottom: 20,
      background: "#FDF3E3", border: "1px solid #F0DBB4" }}>
      <AlertTriangle size={17} style={{ color: "#B45309", flexShrink: 0, marginTop: 1 }} />
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#78350F" }}>
        <strong>{task.title}</strong> is <strong>{STATE_META[task.state].label.toLowerCase()}</strong>.
        {task.state === "overdue"
          ? " It has already missed its deadline — the only exits are completing it (with its reflection logged) or routing it back through the retry loop."
          : " It can only leave the board by being completed, or by entering the Retry/Handoff loop and being reassigned to someone in the pool."}
      </p>
    </div>
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <Btn ghost onClick={onClose}>Understood</Btn>
      <Btn ink onClick={onRoute}><RotateCcw size={14} /> Route to Retry & reassign</Btn>
    </div>
  </Modal>
);

/* ================================ TOASTS ================================== */
const ToastHost = ({ toasts }) => (
  <div style={{ position: "fixed", top: 18, right: 18, zIndex: 90, display: "flex", flexDirection: "column", gap: 8 }}>
    {toasts.map((t) => (
      <div key={t.id} className="pd-toast" style={{
        display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: 13,
        /* The success pill is a fixed dark-surface/white-text style, same
         * reasoning as Btn's `ink` variant — it reads fine as a dark chip on
         * either a light or dark page, so it doesn't need to flip with the
         * theme. The error pill DOES use theme tokens: a literal light-pink
         * error background would look washed out and low-contrast sitting
         * on a dark page. */
        background: t.kind === "error" ? T.dangerBg : "#16181D",
        color: t.kind === "error" ? T.danger : "#FFFFFF",
        border: t.kind === "error" ? `1px solid ${T.dangerLine}` : "none",
        boxShadow: T.shadowLg, fontSize: 12.5, fontWeight: 500, maxWidth: 360,
      }}>
        {t.kind === "error" ? <AlertTriangle size={14} /> : <Check size={14} style={{ color: T.lime }} />}
        {t.msg}
      </div>
    ))}
  </div>
);

/* --------------------------------- CONFETTI ---------------------------------
 * Dependency-free — a handful of divs with a randomized fall/drift/rotate
 * CSS animation, self-clearing after it finishes. `trigger` is a fresh key
 * each time (uid()), which is what lets the same celebration fire twice in a
 * row — a plain boolean wouldn't re-trigger the effect on a second identical
 * value. */
const CONFETTI_COLORS = ["#C6F04D", "#7CB518", "#0284C7", "#D97706", "#7C5CDB", "#0E9F6E"];
const Confetti = ({ trigger, big }) => {
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    if (!trigger) return;
    const count = big ? 70 : 26;
    setPieces(Array.from({ length: count }, (_, i) => ({
      id: i, left: Math.random() * 100, delay: Math.random() * 0.35,
      duration: 1.7 + Math.random() * 1.3, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: Math.round(Math.random() * 520 - 260), drift: Math.round((Math.random() - 0.5) * 220),
      w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
    })));
    const t = setTimeout(() => setPieces([]), 3200);
    return () => clearTimeout(t);
  }, [trigger, big]);
  if (!pieces.length) return null;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 200, pointerEvents: "none", overflow: "hidden" }}>
      {pieces.map((p) => (
        <span key={p.id} style={{
          position: "absolute", top: -20, left: `${p.left}%`, width: p.w, height: p.h,
          background: p.color, borderRadius: 2,
          animation: `pdConfetti ${p.duration}s cubic-bezier(.24,.7,.4,1) ${p.delay}s forwards`,
          "--pd-drift": `${p.drift}px`, "--pd-rot": `${p.rotate}deg`,
        }} />
      ))}
    </div>
  );
};

/* ============================================================================
 * PROFILE GATE (v12, items 7/22) — a one-time, blocking "who are you" step
 * right after sign-up. Separate from AuthGate's email/password (an *account*
 * credential): this is the *identity* every workspace needs in order to add
 * you to its Team roster automatically the moment you join it (see
 * ensureTeamMemberForMembership in lib/db.js) and to greet you by name.
 * Shown once — there's no skip and no dismiss, only forward.
 * ==========================================================================*/
const ProfileGateScreen = ({ onSave }) => {
  const [fullName, setFullName] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = fullName.trim().length > 1 && jobRole.trim().length > 1;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await onSave({ fullName: fullName.trim(), jobRole: jobRole.trim() });
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, padding: 20 }}>
      <Card style={{ width: "100%", maxWidth: 400, padding: 32 }}>
        <h1 style={{ margin: "0 0 6px", fontFamily: T.fontDisplay, fontSize: 21, fontWeight: 700, color: T.ink }}>
          Welcome to Puroductive
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
          Tell us who you are — this is what teammates see the moment you join a workspace
          (added straight to its Team roster), and what lets the app greet you by name.
        </p>
        <div style={{ display: "grid", gap: 16 }}>
          <div><Label>Full name</Label>
            <input autoFocus style={inputStyle} value={fullName} placeholder="e.g. Aiko Tanaka"
              onChange={(e) => setFullName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
          <div><Label>Role / title</Label>
            <input style={inputStyle} value={jobRole} placeholder="e.g. Operations Manager"
              onChange={(e) => setJobRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
          <Btn disabled={!valid || busy} onClick={submit}><Check size={15} /> {busy ? "Saving…" : "Continue"}</Btn>
        </div>
      </Card>
    </div>
  );
};

/* =============================== MAIN APP ================================= */
export default function PuroductiveApp({ session }) {
  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [events, setEvents] = useState([]);
  const [engine, dispatch] = useReducer(engineReducer, {
    tasks: [], transitions: [], reflections: [], handoffs: [], interventions: [],
  });
  const [view, setView] = useState("dashboard");
  const [openProjectId, setOpenProjectId] = useState(null);
  const [activeCompanyId, setActiveCompanyId] = useState("all");
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [alertsOn, setAlertsOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  /* Named colorMode, not theme — `theme` is already taken throughout this
   * file for the per-company accent (mesh colors), which is a completely
   * different axis from light/dark mode. */
  const [colorMode, setColorMode] = useState(getInitialTheme);
  const toggleColorMode = () => {
    const next = colorMode === "dark" ? "light" : "dark";
    setColorMode(next);
    applyTheme(next);
  };

  /* --------------------------------- tour ----------------------------------
   * Keyed by user id (not just a flat flag) so a second person signing into
   * the same browser still gets their own first run, same reasoning as the
   * per-workspace localStorage key used elsewhere. Shown automatically once
   * loading finishes; re-openable any time via the ? button in the sidebar. */
  const [showTour, setShowTour] = useState(false);
  const tourStorageKey = session?.user?.id ? `pd.tourSeen.${session.user.id}` : null;
  const dismissTour = () => {
    setShowTour(false);
    if (tourStorageKey) localStorage.setItem(tourStorageKey, "1");
  };

  /* --------------------------- profile gate (v12) --------------------------
   * `undefined` = still checking, `null` = no profile row yet (blocks the
   * whole app behind ProfileGateScreen), an object = loaded. Independent of
   * which workspace is active — this is account-level identity, checked
   * exactly once per sign-in. */
  const [profile, setProfile] = useState(undefined);
  useEffect(() => {
    db.fetchMyProfile().then(setProfile).catch(() => setProfile(null));
  }, []);
  const saveProfile = async ({ fullName, jobRole }) => {
    try {
      await db.upsertProfile({ fullName, jobRole });
      setProfile({ fullName, jobRole });
      toast(`Welcome, ${fullName.split(" ")[0]} — your daily task manager assistant is ready.`);
    } catch (e) {
      toast(`Could not save your profile: ${e.message}`, "error");
    }
  };

  /* --------------------------- workspaces (v4) ----------------------------
   * The workspace is chosen before any data loads, because every query is
   * filtered by it. `null` means "still discovering which workspaces this
   * account belongs to". The last choice is remembered per browser so a
   * refresh doesn't dump a team member back into their personal workspace. */
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const myRole = activeWorkspace?.myRole ?? "viewer";
  const readOnly = !canWrite(myRole);
  /* Which roster entry I am in this workspace, if an invite linked me to one.
   * This is what makes "is this task request for me?" answerable. */
  const myMembership = memberships.find((m) => (m.email || "").toLowerCase() === (session?.user?.email || "").toLowerCase());
  const myMemberId = myMembership?.memberId ?? null;

  /* item 4 — a personal, per-workspace accent color, independent of the
   * dark/light toggle. Re-read and (re)applied whenever the active
   * workspace changes, so two workspaces can look distinct from each other
   * at a glance without touching anything server-side — this is purely a
   * device-local preference, same storage shape as dark/light mode. */
  const [accentTheme, setAccentTheme] = useState(THEME_PRESETS[0]);
  useEffect(() => {
    if (!workspaceId) return;
    const stored = getStoredAccent(workspaceId, THEME_PRESETS[0]);
    setAccentTheme(stored);
    applyAccent(stored);
  }, [workspaceId]);
  const chooseAccent = (theme) => {
    setAccentTheme(theme);
    applyAccent(theme);
    storeAccent(workspaceId, theme);
    setModal(null);
  };

  /* --------------------------- notifications -------------------------------
   * User-scoped, not workspace-scoped, so this lives at the top level rather
   * than inside the per-workspace load effect below — a pending invite to a
   * workspace you haven't joined yet has to be visible no matter which
   * workspace you're currently looking at. */
  const [notifications, setNotifications] = useState([]);
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);
  const loadNotifications = () => {
    db.fetchNotifications().then(setNotifications).catch(() => {});
  };

  /* item 8 — "Message privately" (whisper) from a Team card jumps to Chat
   * with this member id queued; ChatView resolves it into an existing or
   * brand-new DM channel and clears it via onConsumePendingDm. */
  const [pendingDmMemberId, setPendingDmMemberId] = useState(null);
  const startWhisper = (member) => {
    setPendingDmMemberId(member.id);
    goTo("chat");
  };

  /* ------------------------------ the board ------------------------------- */
  const [board, setBoard] = useState({
    posts: [], media: [], comments: [], pollOptions: [], pollVotes: [], requests: [], requestEvents: [],
  });
  const [mediaUrls, setMediaUrls] = useState({});

  /* ---------------------------- Google Calendar ------------------------------
   * workspace-scoped, one connection per (user, workspace) — reloaded on
   * every workspace switch same as everything else in the per-workspace
   * effect below. */
  const [googleConnection, setGoogleConnection] = useState(null);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const loadGoogleConnection = () => {
    db.fetchGoogleConnection().then(setGoogleConnection).catch(() => {});
  };

  /* ------------------- clock automation tokens (item 1, v10) ---------------
   * `freshAutomationToken` only ever holds the most recently generated raw
   * token — cleared the moment the user dismisses it (or generates another),
   * since it's shown exactly once by design. */
  const [automationTokens, setAutomationTokens] = useState([]);
  const [freshAutomationToken, setFreshAutomationToken] = useState(null);
  const loadAutomationTokens = () => {
    db.listAutomationTokens().then(setAutomationTokens).catch(() => {});
  };

  /* ------------------------------ celebration -------------------------------
   * "big" is a project's sand stack filling completely; the small version is
   * any single on-time task completion. Confetti respects reduced-motion —
   * the toast still fires either way, only the animation is skipped. */
  const [celebration, setCelebration] = useState(null);
  const celebratedProjectsRef = useRef(new Set());
  const fireCelebration = (big = false) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setCelebration({ key: uid(), big });
  };

  const toast = (msg, kind = "ok") => {
    const id = uid();
    setToasts((ts) => [...ts, { id, msg, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600);
  };

  /* ------------------- initial load from Supabase -------------------------
   * Persistence "seen" sets/maps are pre-filled with what came from the DB so
   * the watchers below (further down) only push what's genuinely new. */
  const seenTaskIds = useRef(new Set());
  const seenTransitionIds = useRef(new Set());
  const seenReflectionIds = useRef(new Set());
  const seenHandoffStatus = useRef(new Map());
  /* Step 1 — which workspaces does this account belong to? This also claims
   * any pending email invites, so a teammate who was invited while signed out
   * finds the workspace waiting for them on their next sign-in. */
  useEffect(() => {
    let cancelled = false;
    const load = (retriesLeft = 1) => {
      db.fetchWorkspaces().then((list) => {
        if (cancelled) return;
        if (!list.length) {
          /* The v4 trigger gives every new signup a personal workspace, so an
           * empty list means this account predates the migration. Say so
           * plainly rather than showing an empty app that silently drops
           * every write. */
          setLoadError(
            "No workspace found for this account. If you just ran the schema_v4 migration, " +
            "make sure it completed without errors — every account needs a personal workspace row."
          );
          setLoading(false);
          return;
        }
        const remembered = localStorage.getItem("pd.workspaceId");
        const pick = list.find((w) => w.id === remembered) ?? list[0];
        setWorkspaces(list);
        setWorkspaceId(pick.id);
      }).catch((err) => {
        if (cancelled) return;
        if (retriesLeft > 0 && /issued at future/i.test(err.message)) {
          setTimeout(() => { if (!cancelled) load(retriesLeft - 1); }, 1200);
          return;
        }
        /* By far the most likely first-run failure: the app has been deployed
         * but supabase/schema_v4.sql hasn't been run yet, so there is no
         * workspaces table to read. A raw "relation does not exist" tells the
         * user nothing actionable, so name the actual fix. */
        if (/relation .*(workspaces|workspace_members).* does not exist|schema cache/i.test(err.message)) {
          setLoadError(
            "This build needs the workspace tables, which aren't in your database yet. " +
            "Open supabase/schema_v4.sql, read the notes at the top, and run it once in the " +
            "Supabase SQL editor — it's additive and leaves your existing data in place."
          );
        } else {
          setLoadError(err.message);
        }
        setLoading(false);
      });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  /* Loading the board is deliberately failure-tolerant. Someone who has run
   * schema_v4 but not yet schema_v5 has no posts table, and that must not
   * take the whole app down with it — projects, tasks and the calendar are
   * all still perfectly usable. The Board screen explains the gap instead. */
  const [boardAvailable, setBoardAvailable] = useState(true);
  const loadBoard = async () => {
    /* Switching workspaces twice quickly can land an older fetch after a
     * newer one. Capturing the workspace this call was issued for, and
     * dropping the result if it is no longer the active one, keeps one
     * workspace's posts from ever appearing inside another. */
    const issuedFor = db.getActiveWorkspace();
    try {
      const data = await db.fetchBoard();
      const paths = data.media.map((m) => m.path);
      const urls = paths.length ? await db.signMediaUrls(paths).catch(() => ({})) : {};
      if (db.getActiveWorkspace() !== issuedFor) return;
      setBoard(data);
      setMediaUrls(urls);
      setBoardAvailable(true);
    } catch (e) {
      if (db.getActiveWorkspace() !== issuedFor) return;
      if (/does not exist|schema cache/i.test(e.message)) setBoardAvailable(false);
      else toast(`Board failed to load: ${e.message}`, "error");
      setBoard({ posts: [], media: [], comments: [], pollOptions: [], pollVotes: [], requests: [], requestEvents: [] });
    }
  };

  /* Step 2 — load that workspace's data. Re-runs on every workspace switch,
   * which is why it resets the "seen" trackers: they describe what's already
   * in the database for the workspace currently loaded, and carrying them
   * across a switch would make the persistence watchers below skip rows they
   * have never actually written. */
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    db.setActiveWorkspace(workspaceId);
    localStorage.setItem("pd.workspaceId", workspaceId);

    /* Right after sign-in the freshly-minted access token's `iat` can lag a
     * hair behind the clock on whichever Supabase node handles this burst of
     * parallel queries, producing a transient "JWT issued at future" — retry
     * once after a beat instead of making the user refresh manually. */
    const load = (retriesLeft = 1) => {
      Promise.all([db.fetchBootstrap(), db.fetchMemberships(workspaceId), loadBoard()]).then(([data, mems]) => {
        if (cancelled) return;
        setCompanies(data.companies);
        {
          const remembered = localStorage.getItem(`pd.activeCompany.${workspaceId}`);
          setActiveCompanyId(
            remembered && (remembered === "all" || data.companies.some((c) => c.id === remembered))
              ? remembered : "all"
          );
        }
        setMembers(data.members);
        setGroups(data.groups);
        setProjects(data.projects);
        setExceptions(data.exceptions);
        setSessions(data.sessions);
        setEvents(data.events);
        setMemberships(mems);
        loadGoogleConnection();
        loadAutomationTokens();
        setFreshAutomationToken(null);
        seenTaskIds.current = new Set(data.tasks.map((t) => t.id));
        seenTransitionIds.current = new Set(data.transitions.map((t) => t.id));
        seenReflectionIds.current = new Set(data.reflections.map((r) => r.id));
        seenHandoffStatus.current = new Map(data.handoffs.map((h) => [h.id, h.status]));
        dispatch({ type: "INIT", tasks: data.tasks, transitions: data.transitions, reflections: data.reflections, handoffs: data.handoffs });
        /* Seed with whatever's already at 100% on load, so opening the app
         * doesn't itself read as "you just finished all of these" — only a
         * completion that happens *after* this point should celebrate. */
        celebratedProjectsRef.current = new Set(
          data.projects
            .filter((p) => {
              const pTasks = data.tasks.filter((t) => t.projectId === p.id);
              return pTasks.length && computeSandStack(p, pTasks).fillPercent >= 100;
            })
            .map((p) => p.id)
        );
        setLoadError(null);
        setLoading(false);
      }).catch((err) => {
        if (cancelled) return;
        if (retriesLeft > 0 && /issued at future/i.test(err.message)) {
          setTimeout(() => { if (!cancelled) load(retriesLeft - 1); }, 1200);
          return;
        }
        setLoadError(err.message);
        setLoading(false);
      });
    };
    load();
    return () => { cancelled = true; };
  }, [workspaceId]);

  /* ---- persistence watchers: mirror reducer-driven state into Supabase ---- */
  useEffect(() => {
    const fresh = engine.tasks.filter((t) => !seenTaskIds.current.has(t.id));
    if (!fresh.length) return;
    fresh.forEach((t) => seenTaskIds.current.add(t.id));
    fresh.forEach((t) => db.insertTask(t).catch((e) => toast(`Sync failed: ${e.message}`, "error")));
  }, [engine.tasks]);
  useEffect(() => {
    const fresh = engine.transitions.filter((tr) => !seenTransitionIds.current.has(tr.id));
    if (!fresh.length) return;
    fresh.forEach((tr) => seenTransitionIds.current.add(tr.id));
    fresh.forEach((tr) => {
      const task = engine.tasks.find((t) => t.id === tr.taskId);
      db.recordTransition(tr)
        .then(() => task && db.updateTaskState(task))
        .catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    });
  }, [engine.transitions, engine.tasks]);
  useEffect(() => {
    const fresh = engine.reflections.filter((r) => !seenReflectionIds.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => seenReflectionIds.current.add(r.id));
    fresh.forEach((r) => db.insertReflection(r).catch((e) => toast(`Sync failed: ${e.message}`, "error")));
  }, [engine.reflections]);
  useEffect(() => {
    for (const h of engine.handoffs) {
      const prev = seenHandoffStatus.current.get(h.id);
      if (prev === undefined) {
        seenHandoffStatus.current.set(h.id, h.status);
        db.insertHandoff(h).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
      } else if (prev !== h.status) {
        seenHandoffStatus.current.set(h.id, h.status);
        db.updateHandoffStatus(h.id, h.status).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
      }
    }
  }, [engine.handoffs]);

  /* ---------------- ENGINE 6 wiring: clock + calendar --------------------- */
  const activeSession = sessions.find((s) => !s.logoutAt);
  const clockIn = () => {
    if (activeSession) return;
    const newSession = { id: uid(), loginAt: new Date().toISOString(), logoutAt: null };
    setSessions((ss) => [...ss, newSession]);
    db.insertSession(newSession).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    AlarmService.chime();
    toast("Clocked in — the hours counter is running");
  };
  const clockOut = () => {
    if (!activeSession) return;
    const logoutAt = new Date().toISOString();
    setSessions((ss) => ss.map((s) => (s.id === activeSession.id ? { ...s, logoutAt } : s)));
    db.updateSessionLogout(activeSession.id, logoutAt).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    toast("Clocked out — session logged");
  };
  /* Marking a calendar day. This replaced a none → holiday → travel → none
   * click-cycle: leave has to capture a reason (and optionally whose leave it
   * is), and there is no way to ask for that from a bare toggle, so the
   * calendar now opens MarkDayModal and calls back in here. */
  const saveException = (data) => {
    const existing = exceptions.find((x) => x.id === data.id) ?? exceptions.find((x) => x.date === data.date);
    if (existing) {
      const next = { ...existing, ...data, id: existing.id };
      setExceptions((xs) => xs.map((x) => (x.id === existing.id ? next : x)));
      db.updateException(next).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      const ex = { ...data, id: uid(), label: data.label ?? "" };
      setExceptions((xs) => [...xs, ex]);
      db.createException(ex).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
    setModal(null);
    toast(`${EXCEPTION_META[data.type].short} marked for ${data.date}`);
  };
  const clearException = (date) => {
    const cur = exceptions.find((x) => x.date === date);
    if (!cur) return;
    setExceptions((xs) => xs.filter((x) => x.id !== cur.id));
    db.removeException(cur.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    setModal(null);
    toast("Day mark cleared");
  };

  /* ---------------- ENGINE 5 wiring: reminder loop ------------------------ */
  const notifiedRef = React.useRef(new Set());
  useEffect(() => {
    const check = () => {
      for (const t of engine.tasks) {
        if (AlarmService.dueWithinHours(t, 24) && !notifiedRef.current.has(t.id)) {
          notifiedRef.current.add(t.id);
          AlarmService.notify("Puroductive reminder", `"${t.title}" is due ${t.deadline}.`);
          toast(`Reminder: "${t.title}" is due ${t.deadline}`, "error");
        }
      }
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => clearInterval(iv);
  }, [engine.tasks]);
  const enableAlerts = async () => {
    const ok = await AlarmService.requestPermission();
    setAlertsOn(ok);
    AlarmService.notify("Puroductive", ok ? "Native alerts enabled — task reminders will ring here." : "Chime-only mode (notifications blocked).");
    toast(ok ? "Native notifications enabled" : "Notifications blocked — using in-app chime only", ok ? "ok" : "error");
  };

  /* ---------------- notification center: load + light polling ------------- */
  useEffect(() => {
    loadNotifications();
    /* Not realtime — a teammate inviting you while you have the app open
     * shows up within a minute rather than instantly. Matches the existing
     * reminder loop's cadence above rather than adding a second mechanism
     * (a Supabase Realtime subscription) for what's a low-frequency event. */
    const iv = setInterval(loadNotifications, 60_000);
    return () => clearInterval(iv);
  }, []);

  /* Checked exactly once per mount (the ref guard), not on every workspace
   * switch — `loading` also flips true→false on a switch, which would
   * otherwise re-trigger this every time. */
  const tourCheckedRef = useRef(false);
  useEffect(() => {
    if (loading || tourCheckedRef.current || !tourStorageKey) return;
    tourCheckedRef.current = true;
    if (!localStorage.getItem(tourStorageKey)) setShowTour(true);
  }, [loading, tourStorageKey]);

  /* ------------------------- Google Calendar sync -------------------------- */
  const connectGoogle = async () => {
    try {
      const authUrl = await db.startGoogleConnect(workspaceId);
      // Full top-level navigation, deliberately — this leaves the SPA. See
      // db.js's startGoogleConnect for why there's no way around that.
      window.location.href = authUrl;
    } catch (e) {
      toast(`Could not start Google sign-in: ${e.message}`, "error");
    }
  };
  const disconnectGoogleHandler = async () => {
    if (!googleConnection) return;
    setGoogleConnection(null);
    try { await db.disconnectGoogleCalendar(googleConnection.id); toast("Google Calendar disconnected"); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); loadGoogleConnection(); }
  };
  const syncGoogleNow = async () => {
    if (!googleConnection || googleSyncing) return;
    setGoogleSyncing(true);
    try {
      const result = await db.syncGoogleCalendar(workspaceId);
      loadGoogleConnection();
      db.fetchBootstrap().then((data) => setEvents(data.events)).catch(() => {});
      toast(`Synced — ${result.pulled} pulled, ${result.pushed} pushed${result.deleted ? `, ${result.deleted} removed` : ""}`);
    } catch (e) {
      toast(`Google sync failed: ${e.message}`, "error");
    } finally {
      setGoogleSyncing(false);
    }
  };

  /* Polls while connected and the tab is open — matches the scope decision
   * made before building this (sync-while-open first; a server-side
   * scheduled job for "even when closed" is a documented follow-up, not
   * built yet). 3 minutes: frequent enough to feel real, spaced out enough
   * that it isn't hammering Google's API or constantly re-exchanging the
   * refresh token. */
  useEffect(() => {
    if (!googleConnection) return;
    const iv = setInterval(syncGoogleNow, 3 * 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnection?.id]);

  /* Lands here once, right after google-oauth-callback's redirect —
   * ?google=connected or ?google=error&reason=.... Cleaned from the URL
   * immediately so a refresh doesn't re-show the toast. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("google");
    if (!status) return;
    if (status === "connected") {
      toast("Google Calendar connected");
      loadGoogleConnection();
    } else if (status === "error") {
      toast(`Google Calendar connection failed (${params.get("reason") || "unknown reason"})`, "error");
    }
    params.delete("google"); params.delete("reason");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
  }, []);

  /* item 5 — true background sync (schema_v11.sql's cron job), independent
   * of both the manual button above and the while-open poll. */
  const toggleGoogleAutoSync = async (on) => {
    if (!googleConnection) return;
    setGoogleConnection((c) => (c ? { ...c, autoSync: on } : c));
    try { await db.setGoogleAutoSync(googleConnection.id, on); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); loadGoogleConnection(); }
  };
  /* item 5 (found unwired) — for anyone who can't complete Google's consent
   * screen because they're not a registered test user yet. Tells the
   * workspace's own admins/owners to add them, rather than leaving them
   * stuck on a Google error page with no path forward. */
  const requestGoogleAccess = async () => {
    try {
      const notified = await db.requestGoogleCalendarAccess(workspaceId);
      toast(notified > 0
        ? `Asked ${notified} admin${notified > 1 ? "s" : ""} to add you as a Google test user`
        : "No workspace admins to notify — you may already be one yourself");
    } catch (e) {
      toast(`Could not send the request: ${e.message}`, "error");
    }
  };

  /* -------------------- clock automation tokens (item 1) ------------------ */
  const generateAutomationToken = async (label) => {
    try {
      const { token, record } = await db.createAutomationToken(label || "Clock automation");
      setAutomationTokens((ts) => [record, ...ts]);
      setFreshAutomationToken({ token, record });
    } catch (e) {
      toast(`Could not create token: ${e.message}`, "error");
    }
  };
  const revokeAutomationToken = async (id) => {
    setAutomationTokens((ts) => ts.filter((t) => t.id !== id));
    try { await db.revokeAutomationToken(id); toast("Token revoked"); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); loadAutomationTokens(); }
  };

  /* ---------------- ENGINE 7 wiring: report export ------------------------ */
  const exportProject = (proj) => {
    const compiled = compileProjectReport({
      project: proj,
      company: companies.find((c) => c.id === proj.companyId),
      tasks: engine.tasks.filter((t) => t.projectId === proj.id),
      transitions: engine.transitions,
      reflections: engine.reflections,
      members, board,
    });
    downloadProjectDoc(compiled, proj.name.replace(/[^\w]+/g, "-") + "-report.doc");
    toast("Report compiled — Word document downloading");
  };

  /* -------- DEADLINE SWEEP: on mount and whenever tasks change ----------- */
  useEffect(() => {
    const due = engine.tasks.some((t) =>
      ["pending", "in_progress", "retry_pending"].includes(t.state) && isPast(t.deadline));
    if (due) dispatch({ type: "SWEEP" });
  }, [engine.tasks]);

  /* -------- PROJECT COMPLETION: fires once per project, the moment its ---
   * sand stack first reaches 100%. Runs at the top level rather than inside
   * ProjectDetail so it still fires when the task that finished it wasn't
   * completed from that project's own screen (e.g. from the dashboard). */
  useEffect(() => {
    for (const p of projects) {
      const pTasks = engine.tasks.filter((t) => t.projectId === p.id);
      if (!pTasks.length || celebratedProjectsRef.current.has(p.id)) continue;
      const stack = computeSandStack(p, pTasks);
      if (stack.fillPercent >= 100 && !stack.degraded) {
        celebratedProjectsRef.current.add(p.id);
        fireCelebration(true);
        toast(`🎉 "${p.name}" complete — full sand stack`);
      }
    }
  }, [engine.tasks, projects]);

  /* ---------------- Guarded transition helper (the machine's API) -------- */
  const tryTransition = (taskId, event, extras = {}) => {
    const t = engine.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const next = TRANSITIONS[t.state][event];
    if (!next) {
      toast(`Not allowed: ${event.toLowerCase().replace(/_/g, " ")} from "${STATE_META[t.state].label}"`, "error");
      return;
    }
    if (event === "COMPLETE" && t.state === "overdue" &&
        !engine.reflections.some((r) => r.taskId === t.id)) {
      // Reducer will re-queue the intervention; explain why here.
      toast("Reflection required before this overdue task can be completed", "error");
    }
    if (event === "REASSIGN" && !extras.toAssigneeId) {
      toast("Pick a team member to hand this task to", "error");
      return;
    }
    dispatch({ type: "TRANSITION", taskId, event, ...extras });
    if (event === "COMPLETE" && (t.state !== "overdue" || engine.reflections.some((r) => r.taskId === t.id))) {
      if (t.state === "overdue") {
        toast("Completed late — sand restored");
      } else {
        fireCelebration(false);
        toast(CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)]);
      }
      // Auto-advance the queue (item 2) — exactly one "next" task, personal
      // queue taking precedence over the project pipeline. `engine.tasks`
      // here is still pre-dispatch, but that's fine: the candidate is a
      // different task whose own pending state isn't touched by t's own
      // COMPLETE, and React batches this second dispatch right after the
      // first.
      const nextUp = findNextQueuedTask(engine.tasks, t);
      if (nextUp) {
        dispatch({ type: "TRANSITION", taskId: nextUp.id, event: "START" });
        toast(`Next up: "${nextUp.title}"`);
      }
    }
    if (event === "REASSIGN") toast(`Handed off to ${members.find((m) => m.id === extras.toAssigneeId)?.name}`);
    if (event === "FAIL_ATTEMPT") toast("Moved to Retry Pending — reassign or reschedule", "error");
    if (event === "PAUSE") toast(`Paused "${t.title}" — it'll wait its turn in the queue`);
  };

  /* Drag-reorder writes (item 2) — a position, not a state-machine event;
   * see SET_QUEUE_ORDER's comment in engineReducer. */
  const reorderTask = (taskId, patch) => {
    dispatch({ type: "SET_QUEUE_ORDER", taskId, ...patch });
    db.updateTaskQueueOrder(taskId, patch).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
  };

  /* item 9/17 — the RESCHEDULE transition itself is unchanged; this just
   * additionally logs the "why" permanently, the same two-write shape
   * insertReflection/tryTransition already use for overdue completions. */
  const rescheduleTaskReflective = (task, { newDeadline, whatChanged, progressSoFar, planToHold }) => {
    tryTransition(task.id, "RESCHEDULE", { newDeadline });
    db.insertDeadlineExtension({
      taskId: task.id, projectId: task.projectId, oldDeadline: task.deadline || "", newDeadline,
      whatChanged, progressSoFar, planToHold,
    }).catch((e) => toast(`Sync failed (extension log): ${e.message}`, "error"));
    setModal(null);
    toast("Rescheduled — reflection logged");
  };

  /* Completing with an optional photo (item 3) — the transition itself
   * fires immediately either way (so completing never waits on an upload);
   * the photo, if any, attaches as a side-channel patch once it's up. */
  const completeTaskWithPhoto = async (task, file) => {
    tryTransition(task.id, "COMPLETE");
    setModal(null);
    if (!file) return;
    try {
      const path = await db.uploadTaskCompletionPhoto(task.id, file);
      await db.attachTaskCompletionPhoto(task.id, path);
      dispatch({ type: "SET_TASK_PHOTO", taskId: task.id, path });
    } catch (e) {
      toast(`Photo upload failed: ${e.message}`, "error");
    }
  };

  /* Attempted delete → completed tasks archive; anything else is refused
   * and offered the retry loop instead. */
  const attemptDelete = (task) => {
    if (task.state === "completed") {
      dispatch({ type: "ARCHIVE_COMPLETED_TASK", taskId: task.id });
      db.softDeleteTask(task.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
      toast("Completed task archived (tombstoned)");
    } else {
      setModal({ kind: "noDismiss", task });
    }
  };
  const routeToRetry = (task) => {
    if (TRANSITIONS[task.state].FAIL_ATTEMPT) {
      dispatch({ type: "TRANSITION", taskId: task.id, event: "FAIL_ATTEMPT", note: "Deletion refused → routed to retry loop" });
    }
    setModal({ kind: "reassign", taskId: task.id });
  };

  const saveProject = (data) => {
    if (data.id) {
      setProjects((ps) => ps.map((p) => (p.id === data.id ? { ...p, ...data } : p)));
      db.updateProject(data).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      const project = { ...data, id: uid(), status: "active", sortOrder: nextQueueOrder(projects.map((p) => p.sortOrder ?? 0)) };
      setProjects((ps) => [...ps, project]);
      db.insertProject(project).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
    setModal(null);
  };
  /* item 1 — edit/delete/reorder parity with tasks. */
  const deleteProject = (project) => {
    setProjects((ps) => ps.filter((p) => p.id !== project.id));
    db.softDeleteProject(project.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    if (openProjectId === project.id) setOpenProjectId(null);
    toast(`"${project.name}" removed`);
  };
  const reorderProject = (id, sortOrder) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, sortOrder } : p)));
    db.updateProjectSortOrder(id, sortOrder).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
  };
  /* New tasks join the tail of both queues automatically (item 2) — a
   * project-pipeline position, and (only if assigned) a personal-queue
   * position. Reordering only ever happens afterwards, via an explicit
   * drag. */
  const withQueuePositions = (task) => {
    const projectOrders = engine.tasks
      .filter((t) => t.projectId === task.projectId).map((t) => t.queueOrder).filter((v) => v != null);
    let personalQueueOrder = null;
    if (task.assigneeId) {
      const personalOrders = engine.tasks
        .filter((t) => t.assigneeId === task.assigneeId).map((t) => t.personalQueueOrder).filter((v) => v != null);
      personalQueueOrder = nextQueueOrder(personalOrders);
    }
    return {
      ...task, queueOrder: nextQueueOrder(projectOrders), personalQueueOrder,
      activeMinutes: 0, startedAt: null, completionPhotoPath: null,
    };
  };
  /* Task inserts are picked up by the engine.tasks persistence watcher above. */
  const addTask = (task) => { dispatch({ type: "ADD_TASK", task: withQueuePositions(task) }); setModal(null); };

  /* ------------------------- companies CRUD ------------------------------- */
  const saveCompany = (data) => {
    if (data.id) {
      setCompanies((cs) => cs.map((c) => (c.id === data.id ? { ...c, ...data } : c)));
      db.updateCompany(data).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      const company = { ...data, id: "c-" + uid(), sortOrder: nextQueueOrder(companies.map((c) => c.sortOrder ?? 0)) };
      setCompanies((cs) => [...cs, company]);
      db.insertCompany(company).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
    setModal(null);
    toast(data.id ? "Company updated" : "Company added");
  };
  const deleteCompany = (company) => {
    setCompanies((cs) => cs.filter((c) => c.id !== company.id));
    db.softDeleteCompany(company.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    if (activeCompanyId === company.id) chooseCompany("all");
    toast(`${company.name} removed`);
  };
  /* item 1 — drag-reorder, same fractional-order pattern tasks already use. */
  const reorderCompany = (id, sortOrder) => {
    setCompanies((cs) => cs.map((c) => (c.id === id ? { ...c, sortOrder } : c)));
    db.updateCompanySortOrder(id, sortOrder).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
  };
  /* item 6/19 — click a company card to work inside it. */
  const enterCompany = (company) => {
    chooseCompany(company.id);
    goTo("dashboard");
  };

  /* --------------------------- team members CRUD --------------------------- */
  const saveMember = (data, companyIds) => {
    const isEdit = !!data.id;
    const member = { ...data, id: data.id || "m-" + uid(), companyIds };
    const write = isEdit ? db.updateMember(member) : db.insertMember(member);
    if (isEdit) setMembers((ms) => ms.map((m) => (m.id === member.id ? member : m)));
    else setMembers((ms) => [...ms, member]);
    write.then(() => db.setMemberCompanies(member.id, companyIds))
      .catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    setModal(null);
    toast(isEdit ? "Team member updated" : "Team member added");
  };
  const deleteMember = (member) => {
    setMembers((ms) => ms.filter((m) => m.id !== member.id));
    db.softDeleteMember(member.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    toast(`${member.name} removed`);
  };

  /* ------------------------------ groups CRUD ------------------------------ */
  const saveGroup = (data) => {
    if (data.id) {
      setGroups((gs) => gs.map((g) => (g.id === data.id ? { ...g, ...data } : g)));
      db.updateGroup(data).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      const group = { ...data, id: "g-" + uid(), sortOrder: groups.length };
      setGroups((gs) => [...gs, group]);
      db.insertGroup(group).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
  };
  /* item 11 — creating a department inline (e.g. from TaskForm) without
   * leaving to visit Manage Groups first. The id is generated synchronously
   * (same as saveGroup above), so the caller can select it immediately
   * without waiting on the write. */
  const createGroupInline = (name) => {
    const group = { id: "g-" + uid(), name, sortOrder: groups.length, companyId: activeCompanyId !== "all" ? activeCompanyId : null };
    setGroups((gs) => [...gs, group]);
    db.insertGroup(group).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    return group;
  };
  const deleteGroup = (group) => {
    const affected = members.filter((m) => m.groupId === group.id);
    setGroups((gs) => gs.filter((g) => g.id !== group.id));
    setMembers((ms) => ms.map((m) => (m.groupId === group.id ? { ...m, groupId: null } : m)));
    db.softDeleteGroup(group.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    affected.forEach((m) => db.updateMember({ ...m, groupId: null }).catch((e) => toast(`Sync failed: ${e.message}`, "error")));
  };

  /* ------------------------ workspaces & membership ------------------------ */
  /* item 6/19 — the company you're currently "inside", persisted per
   * workspace so re-opening the app returns you to the same company instead
   * of always dumping you back at Overall. The remembered id is validated
   * against the loaded company list once the per-workspace bootstrap
   * finishes (see the load() effect below) — this setter alone can't know
   * yet whether it's still valid. */
  const chooseCompany = (id) => {
    setActiveCompanyId(id);
    if (workspaceId) localStorage.setItem(`pd.activeCompany.${workspaceId}`, id);
    if (isMobile) setSidebarOpen(false);
  };

  const switchWorkspace = (id) => {
    if (id === workspaceId) return;
    /* Reset view state along with the data — an open project id from the old
     * workspace resolves to nothing in the new one and would render a blank
     * detail page. The remembered company for the new workspace, if any, is
     * restored once its bootstrap load finishes below. */
    setOpenProjectId(null);
    setActiveCompanyId("all");
    setView("dashboard");
    setModal(null);
    setWorkspaceId(id);
    if (isMobile) setSidebarOpen(false);
  };
  const addWorkspace = async (name) => {
    try {
      const created = await db.createWorkspace("ws-" + uid(), name);
      setWorkspaces((ws) => [...ws, created]);
      setModal(null);
      toast(`Workspace "${name}" created`);
      switchWorkspace(created.id);
    } catch (e) {
      toast(`Could not create workspace: ${e.message}`, "error");
    }
  };
  const invitePerson = async ({ email, role, memberId }) => {
    try {
      const created = await db.inviteToWorkspace(workspaceId, email, role, memberId || null);
      setMemberships((ms) => [...ms, created]);
    } catch (e) {
      toast(e.message, "error");
      return;
    }
    /* The membership row exists now regardless of what happens below, so a
     * failure here is a softer problem: the invite still works the old way
     * (silently linked next time they sign in), just without an email
     * telling them to look. Surface that distinction rather than treating
     * every outcome as the same success or the same failure. */
    try {
      const { alreadyHadAccount } = await db.sendWorkspaceInviteEmail(workspaceId, email, role);
      toast(alreadyHadAccount
        ? `${email} already has a Puroductive account — they'll see this workspace next time they sign in`
        : `Invite email sent to ${email}`);
    } catch (e) {
      toast(`Added ${email}, but the invite email failed to send: ${e.message}`, "error");
    }
  };
  const changeRole = async (m, role) => {
    setMemberships((ms) => ms.map((x) => (x.id === m.id ? { ...x, role } : x)));
    try { await db.updateMembershipRole(m.id, role); toast(`${m.email} is now ${ROLE_META[role].label.toLowerCase()}`); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); }
  };
  const removePerson = async (m) => {
    setMemberships((ms) => ms.filter((x) => x.id !== m.id));
    try { await db.removeMembership(m.id); toast(`${m.email} removed from this workspace`); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); }
  };

  /* --------------------------- notification center -------------------------- */
  const dismissNotif = (id) => {
    const prev = notifications;
    setNotifications((ns) => ns.filter((n) => n.id !== id));
    /* item 21 — this used to swallow a failure silently, which is exactly
     * what "I can view it but can't clear it" looks like from the outside:
     * the row vanishes from state, then reappears on the next 60s poll with
     * no explanation. Now a real failure restores the row and says why. */
    db.dismissNotification(id).catch((e) => {
      setNotifications(prev);
      toast(`Could not clear that notification: ${e.message}`, "error");
    });
  };
  /* item 21 — bulk clear, since a notification center that only lets you
   * dismiss one at a time doesn't scale past a handful of items. */
  const clearAllNotifications = () => {
    const ids = notifications.map((n) => n.id);
    if (!ids.length) return;
    setNotifications([]);
    Promise.all(ids.map((id) => db.dismissNotification(id))).catch((e) => {
      toast(`Some notifications couldn't be cleared: ${e.message}`, "error");
      loadNotifications();
    });
  };
  const acceptInviteNotif = async (n) => {
    try {
      const newWsId = await db.acceptInvite(n.actionMembershipId);
      /* item 2/7 — join the Team roster of the workspace you just joined.
       * Best-effort: the invite has already been accepted regardless of
       * whether this succeeds, so a failure here only means falling back to
       * the old "an admin adds you to Team manually" path, not losing access. */
      db.ensureTeamMemberForMembership(n.actionMembershipId).catch(() => {});
      dismissNotif(n.id);
      toast("Invite accepted — switching you over");
      /* The freshly-active membership means fetchWorkspaces() will now
       * include this workspace where it didn't before; re-fetching is
       * simpler and less error-prone than hand-assembling a Workspace
       * object client-side from a bare id. */
      const list = await db.fetchWorkspaces();
      setWorkspaces(list);
      switchWorkspace(newWsId);
    } catch (e) {
      toast(`Could not accept: ${e.message}`, "error");
    }
  };
  const declineInviteNotif = async (n) => {
    try {
      await db.declineInvite(n.actionMembershipId);
      dismissNotif(n.id);
      toast("Invite declined");
    } catch (e) {
      toast(`Could not decline: ${e.message}`, "error");
    }
  };
  /* Clicking the body of a notification (not its Accept/Decline buttons)
   * jumps straight to whatever it's about — the "allow user to... directly
   * jump to the tasks" half of the ask. Invite notifications have nothing to
   * jump to yet (there's nothing to open until it's accepted), so this is a
   * no-op for those; Accept/Decline are the whole interaction. */
  const openNotification = (n) => {
    db.markNotificationRead(n.id).catch(() => {});
    setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    if (n.actionTaskId) {
      const t = engine.tasks.find((x) => x.id === n.actionTaskId);
      if (t) { setOpenProjectId(t.projectId); setView("projects"); setNotifCenterOpen(false); }
    } else if (n.actionProjectId) {
      setOpenProjectId(n.actionProjectId); setView("projects"); setNotifCenterOpen(false);
    }
  };

  /* item 10 — "share to board" from a task's notes panel. Scoped to that
   * task's own project's company (not whatever company happens to be active
   * in the sidebar right now), so it always lands in the right team's feed
   * regardless of where you were looking when you shared it. */
  const shareTaskToBoard = async (task, noteBody) => {
    const project = projects.find((p) => p.id === task.projectId);
    try {
      const post = await db.insertPost({
        id: "po-" + uid(), kind: "update", caption: (noteBody || "").trim() || task.title,
        projectId: task.projectId, taskId: task.id, companyId: project?.companyId || null,
        authorMemberId: myMemberId,
      });
      setBoard((b) => ({ ...b, posts: [post, ...b.posts] }));
      toast("Shared to the board");
    } catch (e) {
      toast(`Could not share: ${e.message}`, "error");
    }
  };

  /* ------------------------------- the board -------------------------------
   * Posting is a multi-step write (post row, then media, then poll options or
   * a task request) and there is no transaction across them from the browser.
   * The post row is written first so everything else has a parent to hang
   * off; if a later step fails the post survives as a plain caption, which is
   * a far better failure mode than orphaned media nobody can see. */
  const createPost = async (draft, files) => {
    const postId = "po-" + uid();
    try {
      const post = await db.insertPost({
        id: postId, kind: draft.kind, caption: draft.caption,
        projectId: draft.projectId || null, taskId: draft.taskId || null,
        companyId: draft.companyId || null,
        authorMemberId: myMemberId,
      });

      let media = [];
      if (files.length) {
        const uploaded = [];
        for (const file of files) uploaded.push(await db.uploadPostMedia(postId, file));
        media = await db.insertPostMedia(postId, uploaded);
        const urls = await db.signMediaUrls(uploaded.map((u) => u.path)).catch(() => ({}));
        setMediaUrls((m) => ({ ...m, ...urls }));
      }

      let pollOptions = [], requests = [], requestEvents = [];
      if (draft.kind === "poll") {
        pollOptions = await db.insertPollOptions(postId, draft.pollOptions.filter((o) => o.trim()));
      }
      if (draft.kind === "task_request") {
        const { request, event } = await db.insertTaskRequest({
          id: "tr-" + uid(), postId, projectId: draft.projectId || null,
          title: draft.requestTitle, deadline: draft.requestDeadline || null,
          weight: draft.requestWeight ?? 1, assigneeMemberId: draft.assigneeMemberId || null,
          reason: draft.caption,
        });
        requests = [request]; requestEvents = [event];
      }

      setBoard((b) => ({
        ...b,
        posts: [post, ...b.posts],
        media: [...b.media, ...media],
        pollOptions: [...b.pollOptions, ...pollOptions],
        requests: [...b.requests, ...requests],
        requestEvents: [...b.requestEvents, ...requestEvents],
      }));
      setModal(null);
      toast(POST_KIND_META[draft.kind].posted);
    } catch (e) {
      toast(`Could not post: ${e.message}`, "error");
    }
  };

  const addComment = async (postId, body) => {
    try {
      const c = await db.insertComment(postId, body, myMemberId);
      setBoard((b) => ({ ...b, comments: [...b.comments, c] }));
    } catch (e) { toast(`Comment failed: ${e.message}`, "error"); }
  };

  const vote = async (postId, optionId) => {
    const myUid = session?.user?.id;
    /* Optimistic: replace my existing vote rather than appending, mirroring
     * the unique index that would reject a second row anyway. */
    setBoard((b) => ({
      ...b,
      pollVotes: [...b.pollVotes.filter((v) => !(v.postId === postId && v.voterId === myUid)),
                  { id: "tmp-" + uid(), postId, optionId, voterId: myUid }],
    }));
    try { await db.castVote(postId, optionId); }
    catch (e) { toast(`Vote failed: ${e.message}`, "error"); loadBoard(); }
  };

  const deletePost = async (post) => {
    setBoard((b) => ({ ...b, posts: b.posts.filter((p) => p.id !== post.id) }));
    try { await db.softDeletePost(post.id); toast("Post removed"); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); loadBoard(); }
  };
  /* item 16 — pinned existed as a column since schema_v5 with no way to set
   * it; this is that missing write path, wired to whoever can write here
   * (not just the post's own author) since "the team needs to see this" is
   * often someone else's call to make about someone else's post. */
  const togglePostPinned = async (post) => {
    const pinned = !post.pinned;
    setBoard((b) => ({ ...b, posts: b.posts.map((p) => (p.id === post.id ? { ...p, pinned } : p)) }));
    try { await db.updatePostPinned(post.id, pinned); }
    catch (e) { toast(`Sync failed: ${e.message}`, "error"); loadBoard(); }
  };

  /* Accepting is the moment a board conversation becomes real work: it mints
   * an ordinary task, which from then on lives in the state machine and shows
   * up in the sand stack, the calendar and the reports like any other. */
  const acceptRequest = async (req) => {
    const projectId = req.projectId || projects[0]?.id;
    if (!projectId) { toast("Create a project first — an accepted task has to live somewhere", "error"); return; }
    const task = withQueuePositions({
      id: "t-" + uid(), projectId, title: req.title, state: "pending",
      scope: "individual", assigneeId: req.assigneeMemberId || null, assigneeGroupId: null,
      deadline: req.deadline || null, weight: req.weight ?? 1,
      retryCount: 0, completedAt: null, completedLate: false,
      isMarked: false, markLabel: "", markScope: null, markTargetId: null,
    });
    try {
      /* The task row must exist in Postgres before the request can point at
       * it — task_requests.task_id is a foreign key. Normally new tasks reach
       * the database via the engine.tasks watcher, which fires asynchronously
       * after render and would lose that race, so this one is written
       * directly and pre-registered as "seen" to stop the watcher inserting
       * it a second time. */
      await db.insertTask(task);
      seenTaskIds.current.add(task.id);
      dispatch({ type: "ADD_TASK", task });

      await db.updateTaskRequest(req.id, { status: "accepted", taskId: task.id });
      const event = await db.recordRequestEvent(req.id, {
        action: "accepted", toMemberId: req.assigneeMemberId ?? null,
      });
      setBoard((b) => ({
        ...b,
        requests: b.requests.map((r) => (r.id === req.id ? { ...r, status: "accepted", taskId: task.id } : r)),
        requestEvents: [...b.requestEvents, event],
      }));
      toast(`Accepted — "${req.title}" is now a task`);
    } catch (e) { toast(`Sync failed: ${e.message}`, "error"); }
  };

  /* Declining without naming a successor leaves the request unowned and
   * visible; declining WITH one is a transfer. Both write to the append-only
   * trail, which is what lets a report months later show that this task
   * passed through two people before anyone started it. */
  const declineRequest = async (req, { toMemberId, reason }) => {
    const action = toMemberId ? "transferred" : "declined";
    try {
      await db.updateTaskRequest(req.id, {
        status: toMemberId ? "pending" : "declined",
        assigneeMemberId: toMemberId ?? null,
      });
      const event = await db.recordRequestEvent(req.id, {
        action, fromMemberId: req.assigneeMemberId ?? null, toMemberId: toMemberId ?? null, reason,
      });
      setBoard((b) => ({
        ...b,
        requests: b.requests.map((r) => (r.id === req.id
          ? { ...r, status: toMemberId ? "pending" : "declined", assigneeMemberId: toMemberId ?? null }
          : r)),
        requestEvents: [...b.requestEvents, event],
      }));
      setModal(null);
      toast(toMemberId
        ? `Transferred to ${members.find((m) => m.id === toMemberId)?.name ?? "someone else"} — logged`
        : "Declined — logged");
    } catch (e) { toast(`Sync failed: ${e.message}`, "error"); }
  };

  /* --------------------------- task calendar marks -------------------------- */
  const saveTaskMark = (taskId, mark) => {
    dispatch({ type: "MARK_TASK", taskId, ...mark });
    const t = engine.tasks.find((x) => x.id === taskId);
    if (t) db.updateTaskMark({ ...t, ...mark }).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    setModal(null);
    toast(mark.isMarked ? "Task marked on the calendar" : "Mark removed");
  };

  /* --------------------------- calendar events CRUD ------------------------- */
  const saveEvent = (data) => {
    if (data.id) {
      setEvents((es) => es.map((e) => (e.id === data.id ? { ...e, ...data } : e)));
      db.updateEvent(data).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      const event = { ...data, id: "ev-" + uid() };
      setEvents((es) => [...es, event]);
      db.insertEvent(event).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
    setModal(null);
    toast(data.id ? "Event updated" : "Event added");
  };
  const deleteEvent = (event) => {
    setEvents((es) => es.filter((e) => e.id !== event.id));
    db.softDeleteEvent(event.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    toast("Event removed");
  };

  const intervention = engine.interventions[0];
  const interventionTask = intervention && engine.tasks.find((t) => t.id === intervention.taskId);
  const scopedProjects = projects.filter((p) => activeCompanyId === "all" || p.companyId === activeCompanyId);
  const openProject = projects.find((p) => p.id === openProjectId);
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const theme = activeCompany ? activeCompany.theme : THEME_PRESETS[0];
  const reassignTask = modal?.kind === "reassign" ? engine.tasks.find((t) => t.id === modal.taskId) : null;
  const rescheduleTask = modal?.kind === "reschedule" ? engine.tasks.find((t) => t.id === modal.taskId) : null;

  /* item 6/13/19 — once a specific company is active, Dashboard/Team/Board/
   * Chat all scope down to it instead of showing the whole workspace. */
  const scopedProjectIds = new Set(scopedProjects.map((p) => p.id));
  const scopedEngine = activeCompanyId === "all"
    ? engine
    : { ...engine, tasks: engine.tasks.filter((t) => scopedProjectIds.has(t.projectId)) };
  const scopedMembers = activeCompanyId === "all"
    ? members
    : members.filter((m) => m.companyIds.includes(activeCompanyId));
  /* A group with no company (companyId null) is workspace-wide — e.g. an
   * all-hands crew that spans every division — so it stays visible in every
   * scope, not just "all". */
  const scopedGroups = activeCompanyId === "all"
    ? groups
    : groups.filter((g) => !g.companyId || g.companyId === activeCompanyId);
  const scopedBoard = activeCompanyId === "all"
    ? board
    : { ...board, posts: board.posts.filter((p) => !p.companyId || p.companyId === activeCompanyId) };

  /* item 14 — a personal workspace can never have teammates, so the
   * collaborative-only screens (Board/Team/Chat/Leaderboard/People & access)
   * are dropped from the nav entirely rather than rendered empty/misleading.
   * PeopleView's own "this is personal" message (for anyone who lands there
   * some other way) stays as a defensive fallback. */
  const personalWorkspace = activeWorkspace?.kind === "personal";
  const NAV_ALL = [
    { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
    { key: "board", label: "Board", icon: MessageSquare, collaborative: true },
    { key: "companies", label: "Companies", icon: Building2 },
    { key: "projects", label: "Projects", icon: FolderKanban },
    { key: "team", label: "Team", icon: Users, collaborative: true },
    { key: "people", label: "People & access", icon: UserPlus, collaborative: true },
    { key: "leaderboard", label: "Leaderboard", icon: Trophy, collaborative: true },
    { key: "chat", label: "Chat", icon: MessageCircle, collaborative: true },
    { key: "calendar", label: "Calendar", icon: CalendarDays },
    { key: "gantt", label: "Gantt", icon: GanttChart },
    { key: "reports", label: "Reports", icon: BarChart3 },
  ];
  const NAV = personalWorkspace ? NAV_ALL.filter((n) => !n.collaborative) : NAV_ALL;

  if (profile === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
        background: T.bg, color: T.ink3, fontFamily: T.fontBody, fontSize: 13 }}>
        Loading…
      </div>
    );
  }
  if (profile === null) {
    return <ProfileGateScreen onSave={saveProfile} />;
  }
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
        background: T.bg, color: T.ink3, fontFamily: T.fontBody, fontSize: 13 }}>
        Loading your workspace…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, padding: 20 }}>
        <div style={{ maxWidth: 420, textAlign: "center", color: T.danger, fontSize: 13.5, lineHeight: 1.6 }}>
          Failed to load data from Supabase: {loadError}
        </div>
      </div>
    );
  }

  const goTo = (key) => { setView(key); setOpenProjectId(null); if (isMobile) setSidebarOpen(false); };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.fontBody,
      display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      <GlobalStyle />
      <ToastHost toasts={toasts} />
      <Confetti trigger={celebration?.key} big={celebration?.big} />
      {showTour && <AppTour onClose={dismissTour} />}

      {/* --------------------------- MOBILE TOP BAR ------------------------- */}
      {isMobile && (
        <header style={{
          position: "sticky", top: 0, zIndex: 25, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: T.card, borderBottom: `1px solid ${T.line}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Mesh mesh={["var(--lime-mesh-1)", "var(--lime-mesh-2)", "var(--lime-mesh-3)"]} style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", border: "1px solid rgba(36,51,5,0.1)" }}>
              <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 13, color: "var(--lime-ink)", display: "grid", placeItems: "center", height: "100%" }}>P</span>
            </Mesh>
            <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 14.5, letterSpacing: "-0.02em" }}>Puroductive</span>
          </div>
          <IconBtn label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={17} /></IconBtn>
        </header>
      )}

      {/* ------------------------------ SIDEBAR ---------------------------- */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 29, background: "rgba(22,24,29,0.4)" }} />
      )}
      {(!isMobile || sidebarOpen) && (
        <aside className="pd-scroll" style={{
          position: isMobile ? "fixed" : "sticky", top: 0, left: 0, height: "100vh", width: 232, flexShrink: 0,
          zIndex: 30, overflowY: "auto",
          display: "flex", flexDirection: "column", padding: "26px 16px",
          borderRight: `1px solid ${T.line}`, background: T.card,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 8px", marginBottom: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <Mesh mesh={["var(--lime-mesh-1)", "var(--lime-mesh-2)", "var(--lime-mesh-3)"]} style={{
                width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", flexShrink: 0,
                boxShadow: "0 4px 14px -4px color-mix(in srgb, var(--lime-deep) 55%, transparent)", border: "1px solid rgba(36,51,5,0.1)",
              }}>
                <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 17, color: "var(--lime-ink)", display: "grid", placeItems: "center", height: "100%" }}>P</span>
              </Mesh>
              {/* minWidth:0 + truncation here (not flexShrink:0) is what stops
                * this text from refusing to shrink and pushing the bell/help
                * buttons out past the sidebar's fixed width — a flex item's
                * default min-width is its content size, not 0. */}
              <div style={{ minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Puroductive</div>
                <div style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Workspace OS</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <NotificationBell count={notifications.filter((n) => !n.readAt).length}
                onClick={() => setNotifCenterOpen((o) => !o)} />
              <IconBtn label="Personalize this workspace's color" onClick={() => setModal({ kind: "accentPicker" })}><Palette size={15} /></IconBtn>
              <IconBtn label="Show the app tour" onClick={() => setShowTour(true)}><HelpCircle size={15} /></IconBtn>
              {isMobile && <IconBtn label="Close menu" onClick={() => setSidebarOpen(false)}><X size={15} /></IconBtn>}
            </div>
          </div>

          {notifCenterOpen && (
            <NotificationCenter notifications={notifications}
              onClose={() => setNotifCenterOpen(false)}
              onOpen={openNotification} onDismiss={dismissNotif} onClearAll={clearAllNotifications}
              onAccept={acceptInviteNotif} onDecline={declineInviteNotif} />
          )}

          <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} myRole={myRole}
            onSwitch={switchWorkspace} onCreate={() => setModal({ kind: "workspace" })} />

          <CompanySwitcher companies={companies} activeId={activeCompanyId}
            onSwitch={chooseCompany} onManage={() => goTo("companies")} />

          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {NAV.map(({ key, label, icon: Icon }) => {
              const active = view === key;
              return (
                <button key={key} onClick={() => goTo(key)} className="pd-press" style={{
                  position: "relative", overflow: "hidden",
                  display: "flex", alignItems: "center", gap: 11, minHeight: 42, padding: "0 12px",
                  borderRadius: 11, cursor: "pointer", textAlign: "left",
                  fontSize: 13.5, fontWeight: active ? 600 : 450,
                  /* item 4 — the active nav highlight is the one thing on
                   * screen every single view, so it's the clearest place a
                   * per-workspace accent actually helps tell workspaces
                   * apart at a glance; see the Btn primary variant above for
                   * the same var(--lime-*) treatment. */
                  color: active ? "var(--lime-ink)" : T.ink2,
                  border: active ? "1px solid rgba(36,51,5,0.1)" : "1px solid transparent",
                  boxShadow: active ? "0 2px 8px -2px color-mix(in srgb, var(--lime-deep) 40%, transparent)" : "none",
                  ...(active ? meshBackground(["var(--lime-mesh-1)", "var(--lime-mesh-2)", "var(--lime-mesh-3)"]) : { background: "transparent" }),
                }}>
                  {active && <GrainOverlay opacity={0.2} radius={11} />}
                  <Icon size={16.5} style={{ position: "relative", color: active ? "var(--lime-deep)" : T.ink3 }} />
                  <span style={{ position: "relative" }}>{label}</span>
                </button>
              );
            })}
          </nav>

          <OpenHandoffsPanel handoffs={engine.handoffs} tasks={engine.tasks} members={members} />

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "10px 12px", borderRadius: 12, border: `1px solid ${T.lineSoft}`, background: T.cardSoft }}>
            <div style={{ minWidth: 0, overflow: "hidden" }}>
              {profile?.fullName && (
                <div style={{ fontSize: 12, fontWeight: 600, color: T.ink,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Hi, {profile.fullName.split(" ")[0]}
                </div>
              )}
              <span style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session?.user?.email}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <IconBtn label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleColorMode}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>{colorMode === "dark" ? "☀️" : "🌙"}</span>
              </IconBtn>
              <IconBtn label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={13.5} /></IconBtn>
            </div>
          </div>
        </aside>
      )}

      {/* ------------------------------- MAIN ------------------------------ */}
      <main className="pd-scroll" style={{ flex: 1, padding: isMobile ? "20px 16px 48px" : "34px 40px 60px", maxWidth: 1220, margin: "0 auto", width: "100%" }}>
        {/* A viewer's writes are refused by RLS at the database, so without
          * this they'd click Add, see nothing happen, and have no idea why. */}
        {readOnly && (
          <Card soft style={{ padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 11,
            border: `1px solid ${T.line}` }}>
            <Eye size={15} style={{ color: T.ink3, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.55 }}>
              You have <strong>viewer</strong> access to {activeWorkspace?.name}. You can read everything here,
              but changes won't save — ask an admin for member access.
            </span>
          </Card>
        )}
        {/* item 6/19 — always-visible reminder of which company you're
          * scoped into, with a one-click way back out to the cross-company
          * view. Every view below this point already reads activeCompanyId
          * (via scopedProjects / companyMembers / etc.), so this is purely
          * the "where am I" signal, not a second filter. */}
        {activeCompany && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <CircleDot size={11} style={{ color: activeCompany.theme.primary, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: T.ink3 }}>
              Viewing <strong style={{ color: T.ink, fontWeight: 600 }}>{activeCompany.name}</strong>
            </span>
            <button onClick={() => chooseCompany("all")} className="pd-press" style={{
              marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              fontSize: 11.5, color: T.limeDeep, fontWeight: 600, padding: 0,
            }}>Overall ↗</button>
          </div>
        )}
        {view === "dashboard" && (
          <Dashboard companies={companies} projects={scopedProjects} members={members} engine={scopedEngine}
            theme={theme} activeCompany={activeCompany} myMemberId={myMemberId} tryTransition={tryTransition}
            openProject={(id) => { setOpenProjectId(id); setView("projects"); }}
            onComplete={(t) => setModal({ kind: "completeTask", task: t })}
            onReorder={reorderTask} />
        )}
        {view === "companies" && (
          <CompaniesView companies={companies} projects={projects} members={members}
            onAdd={() => setModal({ kind: "company", data: null })}
            onEdit={(c) => setModal({ kind: "company", data: c })}
            onDelete={deleteCompany} onEnter={enterCompany} onReorder={reorderCompany} />
        )}
        {view === "projects" && !openProject && (
          <ProjectsList projects={scopedProjects} companies={companies} engine={engine}
            onOpen={(p) => setOpenProjectId(p.id)}
            onEdit={(p) => setModal({ kind: "project", data: p })}
            onDelete={deleteProject} onReorder={reorderProject}
            onCreate={() => setModal({ kind: "project", data: null })} />
        )}
        {view === "projects" && openProject && (
          <ProjectDetail project={openProject} companies={companies} members={members} groups={groups} engine={engine}
            onBack={() => setOpenProjectId(null)}
            tryTransition={tryTransition} attemptDelete={attemptDelete}
            onReassign={(t) => setModal({ kind: "reassign", taskId: t.id })}
            onReschedule={(t) => setModal({ kind: "reschedule", taskId: t.id })}
            onMark={(t) => setModal({ kind: "markTask", task: t })}
            onComplete={(t) => setModal({ kind: "completeTask", task: t })}
            onReorder={reorderTask}
            onAddTask={() => setModal({ kind: "task", projectId: openProject.id })}
            onExport={() => exportProject(openProject)} onShareToBoard={shareTaskToBoard} />
        )}
        {view === "team" && (
          <TeamView members={scopedMembers} companies={companies} groups={scopedGroups} engine={scopedEngine}
            memberships={memberships} myMemberId={myMemberId}
            onAddMember={() => setModal({ kind: "member", data: null })}
            onEditMember={(m) => setModal({ kind: "member", data: m })}
            onDeleteMember={deleteMember}
            onManageGroups={() => setModal({ kind: "groupsManage" })}
            onWhisper={startWhisper} />
        )}
        {view === "board" && (
          <BoardView board={scopedBoard} mediaUrls={mediaUrls} available={boardAvailable}
            members={members} projects={projects} companies={companies}
            myUserId={session?.user?.id} myMemberId={myMemberId} readOnly={readOnly}
            onCompose={() => setModal({ kind: "post" })}
            onComment={addComment} onVote={vote} onDelete={deletePost}
            onAccept={acceptRequest}
            onDecline={(req) => setModal({ kind: "declineRequest", req })}
            onTogglePin={togglePostPinned}
            onOpenProject={(id) => { setOpenProjectId(id); setView("projects"); }} />
        )}
        {view === "people" && (
          <PeopleView memberships={memberships} members={members} workspace={activeWorkspace} myRole={myRole}
            myEmail={session?.user?.email}
            onInvite={invitePerson} onChangeRole={changeRole} onRemove={removePerson}
            onRename={(name) => {
              setWorkspaces((ws) => ws.map((w) => (w.id === workspaceId ? { ...w, name } : w)));
              db.renameWorkspace(workspaceId, name).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
              toast("Workspace renamed");
            }} />
        )}
        {view === "leaderboard" && (
          <LeaderboardView tasks={engine.tasks} members={members} />
        )}
        {view === "chat" && (
          <ChatView workspaceId={workspaceId} groups={scopedGroups} members={members} memberships={memberships}
            myUserId={session?.user?.id} myMemberId={myMemberId} readOnly={readOnly}
            pendingDmMemberId={pendingDmMemberId} onConsumePendingDm={() => setPendingDmMemberId(null)} />
        )}
        {view === "calendar" && (
          <CalendarView exceptions={exceptions}
            sessions={sessions} activeSession={activeSession} clockIn={clockIn} clockOut={clockOut}
            tasks={engine.tasks} alertsOn={alertsOn} enableAlerts={enableAlerts}
            events={events} projects={projects} companies={companies} members={members} groups={groups}
            googleConnection={googleConnection} googleSyncing={googleSyncing}
            onConnectGoogle={connectGoogle} onDisconnectGoogle={disconnectGoogleHandler} onSyncGoogleNow={syncGoogleNow}
            onToggleGoogleAutoSync={toggleGoogleAutoSync} onRequestGoogleAccess={requestGoogleAccess}
            automationTokens={automationTokens} freshAutomationToken={freshAutomationToken}
            onGenerateAutomationToken={generateAutomationToken} onRevokeAutomationToken={revokeAutomationToken}
            onDismissFreshToken={() => setFreshAutomationToken(null)}
            onAddEvent={(date) => setModal({ kind: "event", data: null, date })}
            onEditEvent={(ev) => setModal({ kind: "event", data: ev })}
            onDeleteEvent={deleteEvent}
            onMarkDay={(ymd) => setModal({ kind: "markDay", date: ymd })}
            onOpenDay={(ymd) => setModal({ kind: "dayDetail", date: ymd })}
            onOpenProject={(id) => { setOpenProjectId(id); setView("projects"); }} />
        )}
        {view === "gantt" && (
          <GanttView companies={companies} scopedProjects={scopedProjects} members={members} tasks={engine.tasks} />
        )}
        {view === "reports" && (
          <ReportsView sessions={sessions} tasks={engine.tasks} exceptions={exceptions}
            projects={projects} companies={companies} onExport={exportProject} />
        )}
      </main>

      {/* ---------------- STRICT SUPERVISOR — always wins the z-order ------- */}
      {interventionTask && (
        <InterventionModal task={interventionTask}
          project={projects.find((p) => p.id === interventionTask.projectId)}
          onSubmit={(answers) => {
            dispatch({ type: "SUBMIT_REFLECTION", taskId: interventionTask.id, projectId: interventionTask.projectId, answers });
            toast("Reflection logged permanently. You may now complete or reassign the task.");
          }} />
      )}

      {/* ------------------------------ MODALS ------------------------------ */}
      {!interventionTask && modal?.kind === "noDismiss" && (
        <NoDismissModal task={modal.task} onClose={() => setModal(null)}
          onRoute={() => routeToRetry(modal.task)} />
      )}
      {!interventionTask && reassignTask && (
        <ReassignModal task={reassignTask} members={members} groups={groups} companies={companies} myMemberId={myMemberId}
          onClose={() => setModal(null)}
          onConfirm={(x) => { tryTransition(reassignTask.id, "REASSIGN", x); setModal(null); }} />
      )}
      {!interventionTask && rescheduleTask && (
        <RescheduleModal task={rescheduleTask} onClose={() => setModal(null)}
          onConfirm={(extras) => rescheduleTaskReflective(rescheduleTask, extras)} />
      )}
      {!interventionTask && modal?.kind === "task" && (
        <TaskForm projectId={modal.projectId} members={members} groups={groups} companies={companies} myMemberId={myMemberId}
          onCreateGroup={createGroupInline} onSave={addTask} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "project" && (
        <ProjectForm data={modal.data} companies={companies} defaultCompanyId={activeCompanyId}
          onSave={saveProject} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "company" && (
        <CompanyForm data={modal.data} onSave={saveCompany} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "member" && (
        <MemberForm data={modal.data} companies={companies} groups={groups}
          onSave={saveMember} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "groupsManage" && (
        <GroupsManageModal groups={groups} companies={companies} defaultCompanyId={activeCompanyId}
          onSave={saveGroup} onDelete={deleteGroup} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "event" && (
        <CalendarEventForm data={modal.data} defaultDate={modal.date} companies={companies} projects={projects} members={members}
          onSave={saveEvent} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "dayDetail" && (
        <DayDetailModal date={modal.date} exceptions={exceptions}
          events={events} tasks={engine.tasks} projects={projects} companies={companies} members={members}
          onAddEvent={(date) => setModal({ kind: "event", data: null, date })}
          onEditEvent={(ev) => setModal({ kind: "event", data: ev })}
          onDeleteEvent={deleteEvent}
          onMarkDay={(date) => setModal({ kind: "markDay", date })}
          onMarkTask={(t) => setModal({ kind: "markTask", task: t })}
          onOpenProject={(id) => { setOpenProjectId(id); setView("projects"); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "markDay" && (
        <MarkDayModal date={modal.date} existing={exceptions.find((x) => x.date === modal.date)}
          members={members} onSave={saveException} onClear={clearException} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "markTask" && (
        <MarkTaskModal task={modal.task} members={members} groups={groups}
          onSave={(mark) => saveTaskMark(modal.task.id, mark)} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "completeTask" && (
        <CompleteTaskModal task={modal.task}
          onComplete={(file) => completeTaskWithPhoto(modal.task, file)}
          onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "workspace" && (
        <WorkspaceForm onSave={addWorkspace} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "accentPicker" && (
        <AccentPickerModal value={accentTheme} onSave={chooseAccent} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "post" && (
        <PostComposer members={members} projects={projects} tasks={engine.tasks}
          companies={companies} defaultCompanyId={activeCompanyId}
          onSave={createPost} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "declineRequest" && (
        <DeclineRequestModal req={modal.req} members={members}
          onConfirm={(x) => declineRequest(modal.req, x)} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

/* ============================================================================
 * NOTIFICATION CENTER — persistent, not a toast that vanishes.
 *
 * Toasts (ToastHost, further down) are for "this thing you just did worked" —
 * transient, self-explaining, gone in a few seconds. Notifications are for
 * things that happened that you need to actually act on or come back to
 * later: a pending invite, work someone else finished. They stay until you
 * dismiss them, and dismissing is the swipe-off gesture rather than a timer.
 * ==========================================================================*/
const relativeTime = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const NotificationBell = ({ count, onClick }) => (
  <button onClick={onClick} className="pd-press" aria-label="Notifications" style={{
    position: "relative", width: 32, height: 32, borderRadius: 10, cursor: "pointer",
    display: "grid", placeItems: "center", background: T.card, border: `1px solid ${T.line}`,
  }}>
    <Bell size={15} style={{ color: T.ink2 }} />
    {count > 0 && (
      <span className="pd-num" style={{
        position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px",
        borderRadius: 99, background: T.danger, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700,
        display: "grid", placeItems: "center", border: `1.5px solid ${T.card}`,
      }}>{count > 9 ? "9+" : count}</span>
    )}
  </button>
);

/* One row, draggable horizontally — past the threshold on release, it
 * dismisses; short of it, it snaps back. The visible ✕ button covers the
 * same action for anyone not on a touch/drag-capable input. */
const NotificationRow = ({ n, onOpen, onDismiss, onAccept, onDecline }) => {
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef(null);
  const DISMISS_AT = 90;

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, active: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current?.active) return;
    setDragX(e.clientX - dragRef.current.startX);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current.active = false;
    if (Math.abs(dragX) > DISMISS_AT) onDismiss(n.id);
    else setDragX(0);
  };

  const isInvite = n.kind === "invite_pending";
  const opacity = Math.max(0, 1 - Math.abs(dragX) / 260);

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 13, marginBottom: 7 }}>
      {/* Revealed behind the row while dragging, in the direction being dragged. */}
      <div aria-hidden style={{ position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: dragX > 0 ? "flex-start" : "flex-end",
        padding: "0 16px", background: T.dangerBg, color: T.danger }}>
        <Trash2 size={14} />
      </div>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={endDrag} onPointerCancel={endDrag}
        style={{
          position: "relative", padding: "11px 12px", borderRadius: 13,
          background: n.readAt ? T.card : T.cardSoft, border: `1px solid ${n.readAt ? T.line : T.limeDeep}`,
          transform: `translateX(${dragX}px)`, opacity,
          transition: dragRef.current?.active ? "none" : "transform 200ms cubic-bezier(.22,1,.36,1), opacity 200ms",
          cursor: "grab", touchAction: "pan-y",
        }}>
        <div onClick={() => !isInvite && onOpen(n)} style={{ cursor: isInvite ? "default" : "pointer" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            {!n.readAt && <span style={{ width: 6, height: 6, borderRadius: 99, background: T.limeDeep, marginTop: 5, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 2, lineHeight: 1.5 }}>{n.body}</div>}
              <div className="pd-num" style={{ fontSize: 10.5, color: T.ink3, marginTop: 4 }}>{relativeTime(n.at)}</div>
            </div>
            <IconBtn label="Dismiss" onClick={() => onDismiss(n.id)}><X size={12} /></IconBtn>
          </div>
        </div>
        {isInvite && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn small onClick={() => onAccept(n)}><Check size={13} /> Accept</Btn>
            <Btn small ghost onClick={() => onDecline(n)}>Decline</Btn>
          </div>
        )}
      </div>
    </div>
  );
};

const NotificationCenter = ({ notifications, onClose, onOpen, onDismiss, onAccept, onDecline, onClearAll }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px", marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>
        Notifications
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {notifications.length > 0 && (
          <button onClick={onClearAll} className="pd-press" style={{ background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: T.limeDeep, fontWeight: 600, padding: 0 }}>Clear all</button>
        )}
        <button onClick={onClose} className="pd-press" style={{ background: "none", border: "none", cursor: "pointer",
          fontSize: 11, color: T.ink3, padding: 0 }}>Close</button>
      </div>
    </div>
    <div className="pd-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
      {notifications.length === 0
        ? <div style={{ padding: "14px 12px", fontSize: 12, color: T.ink3 }}>Nothing waiting on you.</div>
        : notifications.map((n) => (
            <NotificationRow key={n.id} n={n} onOpen={onOpen} onDismiss={onDismiss} onAccept={onAccept} onDecline={onDecline} />
          ))}
    </div>
  </div>
);

/* ---------------------- WORKSPACE SWITCHER (sidebar) -----------------------
 * Collapsed to a single row until clicked — a solo user has exactly one
 * workspace and shouldn't be made to look at a list of one. */
const WorkspaceSwitcher = ({ workspaces, activeId, myRole, onSwitch, onCreate }) => {
  const [open, setOpen] = useState(false);
  const active = workspaces.find((w) => w.id === activeId);
  if (!active) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <Label>Workspace</Label>
      <button onClick={() => setOpen((o) => !o)} className="pd-press" style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", minHeight: 40, padding: "0 11px",
        borderRadius: 11, cursor: "pointer", textAlign: "left",
        border: `1px solid ${T.line}`, background: T.cardSoft,
      }}>
        <Layers size={14} style={{ color: T.limeDeep, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.name}</div>
          <div style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {active.kind === "personal" ? "Personal" : ROLE_META[myRole]?.label ?? myRole}
          </div>
        </div>
        <ChevronsUpDown size={13} style={{ color: T.ink3, flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
          {workspaces.map((w) => (
            <button key={w.id} onClick={() => { onSwitch(w.id); setOpen(false); }} className="pd-press" style={{
              display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 11px",
              borderRadius: 9, cursor: "pointer", textAlign: "left", fontSize: 12,
              fontWeight: w.id === activeId ? 600 : 450, color: w.id === activeId ? T.ink : T.ink2,
              background: w.id === activeId ? T.bg : "transparent",
              border: `1px solid ${w.id === activeId ? T.line : "transparent"}`,
            }}>
              {w.kind === "personal" ? <Lock size={10} style={{ color: T.ink3, flexShrink: 0 }} />
                                     : <Users size={10} style={{ color: T.ink3, flexShrink: 0 }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
            </button>
          ))}
          <button onClick={() => { onCreate(); setOpen(false); }} className="pd-press" style={{
            display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 11px",
            borderRadius: 9, cursor: "pointer", textAlign: "left", fontSize: 12,
            color: T.limeDeep, fontWeight: 600, background: "transparent", border: "1px solid transparent",
          }}>
            <Plus size={11} style={{ flexShrink: 0 }} /> New workspace
          </button>
        </div>
      )}
    </div>
  );
};

/* ------------------------ COMPANY SWITCHER (sidebar, v12) ------------------
 * The primary day-to-day context switch, directly under the Workspace one —
 * a workspace is the account you're signed into; a company is the division
 * you're currently working inside of it. "Overall" (id "all") is the
 * cross-company summary every other view already understood as the default;
 * picking an actual company scopes Dashboard/Team/Board/Chat down to it. */
const CompanySwitcher = ({ companies, activeId, onSwitch, onManage }) => {
  const [open, setOpen] = useState(false);
  const active = companies.find((c) => c.id === activeId) ?? null;
  return (
    <div style={{ marginBottom: 22 }}>
      <Label>Company</Label>
      <button onClick={() => setOpen((o) => !o)} className="pd-press" style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", minHeight: 40, padding: "0 11px",
        borderRadius: 11, cursor: "pointer", textAlign: "left",
        border: `1px solid ${T.line}`, background: T.cardSoft,
      }}>
        {active
          ? <CircleDot size={14} style={{ color: active.theme.primary, flexShrink: 0 }} />
          : <Layers size={14} style={{ color: T.limeDeep, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {active ? active.name : "Overall"}
          </div>
          <div style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {active ? "Company" : "All companies combined"}
          </div>
        </div>
        <ChevronsUpDown size={13} style={{ color: T.ink3, flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
          <button onClick={() => { onSwitch("all"); setOpen(false); }} className="pd-press" style={{
            display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 11px",
            borderRadius: 9, cursor: "pointer", textAlign: "left", fontSize: 12,
            fontWeight: activeId === "all" ? 600 : 450, color: activeId === "all" ? T.ink : T.ink2,
            background: activeId === "all" ? T.bg : "transparent",
            border: `1px solid ${activeId === "all" ? T.line : "transparent"}`,
          }}>
            <Layers size={10} style={{ color: T.ink3, flexShrink: 0 }} />
            <span>Overall (all companies)</span>
          </button>
          {companies.map((c) => (
            <button key={c.id} onClick={() => { onSwitch(c.id); setOpen(false); }} className="pd-press" style={{
              display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 11px",
              borderRadius: 9, cursor: "pointer", textAlign: "left", fontSize: 12,
              fontWeight: c.id === activeId ? 600 : 450, color: c.id === activeId ? T.ink : T.ink2,
              background: c.id === activeId ? T.bg : "transparent",
              border: `1px solid ${c.id === activeId ? T.line : "transparent"}`,
            }}>
              <CircleDot size={10} style={{ color: c.theme.primary, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </button>
          ))}
          {companies.length === 0 && (
            <div style={{ padding: "8px 11px", fontSize: 11.5, color: T.ink3 }}>No companies yet.</div>
          )}
          <button onClick={() => { onManage(); setOpen(false); }} className="pd-press" style={{
            display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 11px",
            borderRadius: 9, cursor: "pointer", textAlign: "left", fontSize: 12,
            color: T.limeDeep, fontWeight: 600, background: "transparent", border: "1px solid transparent",
          }}>
            <Building2 size={11} style={{ flexShrink: 0 }} /> Manage companies
          </button>
        </div>
      )}
    </div>
  );
};

/* ------------------------ OPEN HANDOFFS (sidebar) -------------------------- */
const OpenHandoffsPanel = ({ handoffs, tasks, members }) => {
  const open = handoffs.filter((h) => h.status === "pending");
  return (
    <div style={{ marginTop: "auto" }}>
      {open.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Label>Open handoffs</Label>
          <div style={{ display: "grid", gap: 6 }}>
            {open.slice(-3).map((h) => {
              const m = members.find((x) => x.id === h.toAssigneeId);
              const t = tasks.find((x) => x.id === h.taskId);
              return (
                <div key={h.id} style={{ padding: "9px 11px", borderRadius: 11,
                  background: "#FDF3E3", border: "1px solid #F0DBB4" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "#78350F" }}>Has {m?.name} completed the follow-up?</div>
                  <div style={{ fontSize: 10.5, color: "#B45309", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t?.title}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ padding: "13px 12px", borderRadius: 14, background: T.cardSoft, border: `1px solid ${T.lineSoft}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.ink2 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: T.limeDeep, boxShadow: "0 0 0 3px rgba(124,181,24,0.18)" }} />
          Engines live · local-first
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ MY QUEUE ITEM ------------------------------
 * One row in the personal queue (item 2) — the active task gets the live
 * duration badge plus Pause/Complete; anything still pending gets a Start
 * button and is drag-reorderable via the parent DragQueueList. */
const MyQueueItem = ({ task, projects, active, onStart, onPause, onComplete }) => {
  const p = projects.find((x) => x.id === task.projectId);
  return (
    <Card style={{
      padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      border: active ? `1.5px solid ${T.limeDeep}` : `1px solid ${T.line}`,
      boxShadow: active ? "0 0 0 3px rgba(124,181,24,0.14)" : "none",
    }}>
      {!active && <GripVertical size={14} style={{ color: T.ink3, flexShrink: 0, cursor: "grab" }} />}
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{task.title}</span>
          {active && <TaskDurationBadge task={task} />}
        </div>
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
          {p?.name ?? "—"}{task.estimatedMinutes ? ` · est. ${task.estimatedMinutes} min` : ""}
        </div>
      </div>
      {active ? (
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small ghost onClick={onPause}><Pause size={13} /> Pause</Btn>
          <Btn small onClick={onComplete}><Check size={13} /> Complete</Btn>
        </div>
      ) : (
        <Btn small ghost onClick={onStart}><Play size={13} /> Start</Btn>
      )}
    </Card>
  );
};

/* =============================== DASHBOARD ================================ */
const Dashboard = ({ companies, projects, members, engine, theme, activeCompany, openProject, myMemberId, tryTransition, onComplete, onReorder }) => {
  const active = projects.filter((p) => p.status === "active");
  const overdue = engine.tasks.filter((t) => t.state === "overdue");
  const retrying = engine.tasks.filter((t) => t.state === "retry_pending");
  const openHandoffs = engine.handoffs.filter((h) => h.status === "pending");
  const attention = overdue.length + retrying.length;

  const myRow = myMemberId
    ? computeLeaderboard(engine.tasks, members, monthWindow(0).start.toISOString()).find((r) => r.member.id === myMemberId)
    : null;
  const myQueueTasks = myMemberId
    ? engine.tasks.filter((t) => t.assigneeId === myMemberId && (t.state === "pending" || t.state === "in_progress"))
    : [];
  const myActiveTask = myQueueTasks.find((t) => t.state === "in_progress");
  const myPendingQueue = myQueueTasks.filter((t) => t.state === "pending");

  return (
    <div className="pd-fade-in">
      <Mesh mesh={attention > 0 ? MOLD_MESH : theme.mesh} style={{
        borderRadius: 24, padding: "32px 36px", marginBottom: 22,
        border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowMd,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase",
              color: attention > 0 ? MOLD_INK : theme.ink, opacity: 0.65, marginBottom: 12 }}>
              {activeCompany ? `${activeCompany.name} overview` : "Cross-company overview"}
            </div>
            <h1 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 38, fontWeight: 700, letterSpacing: "-0.035em",
              lineHeight: 1.05, color: attention > 0 ? MOLD_INK : theme.ink }}>
              {attention > 0
                ? <>Attention required.<br />{attention} task{attention > 1 ? "s" : ""} in the danger loop.</>
                : <>Good day.<br />Everything is under supervision.</>}
            </h1>
            <p style={{ margin: "12px 0 0", fontSize: 13.5, color: attention > 0 ? MOLD_INK : theme.ink, opacity: 0.7 }}>
              {active.length} live projects · {overdue.length} overdue · {retrying.length} retry pending · {openHandoffs.length} open handoffs
            </p>
          </div>
          {/* item 7 — your points, always visible regardless of the
            * leaderboard-competition toggle (item 6): that toggle only
            * hides you from the ranking, not your own number. */}
          {myRow && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
                color: attention > 0 ? MOLD_INK : theme.ink, opacity: 0.65 }}>Your points</div>
              <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 30, fontWeight: 700,
                color: attention > 0 ? MOLD_INK : theme.ink }}>{myRow.points}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "flex-end" }}>
                <Chip bg="rgba(255,255,255,0.5)" color={levelForPoints(myRow.points).color}>
                  <Award size={10} /> {levelForPoints(myRow.points).label}
                </Chip>
              </div>
            </div>
          )}
        </div>
      </Mesh>

      {/* --------------------------- MY QUEUE (item 2) ----------------------
        * A YouTube-Music-style personal queue: whatever's active runs with a
        * live timer, drag the rest into the order you actually want to work
        * them — completing the active one auto-starts the next. */}
      {myQueueTasks.length > 0 && (
        <>
          <SectionHead title="My queue" />
          <div style={{ marginBottom: 32 }}>
            {myActiveTask && (
              <MyQueueItem task={myActiveTask} projects={projects} active
                onPause={() => tryTransition(myActiveTask.id, "PAUSE")}
                onComplete={() => onComplete(myActiveTask)} />
            )}
            {myPendingQueue.length > 0 && (
              <div style={{ marginTop: myActiveTask ? 10 : 0 }}>
                {!myActiveTask && myPendingQueue.length > 1 && (
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: T.ink3 }}>
                    <GripVertical size={11} style={{ verticalAlign: -1 }} /> Drag to reorder — like a music queue.
                  </p>
                )}
                <DragQueueList items={myPendingQueue} orderKey="personalQueueOrder"
                  onReorder={(taskId, personalQueueOrder) => onReorder(taskId, { personalQueueOrder })}
                  renderItem={(t) => (
                    <MyQueueItem task={t} projects={projects}
                      onStart={() => tryTransition(t.id, "START")} />
                  )} />
              </div>
            )}
          </div>
        </>
      )}

      <SectionHead title="Project sand stacks" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {active.map((p) => {
          const c = companies.find((x) => x.id === p.companyId);
          const stack = computeSandStack(p, engine.tasks.filter((t) => t.projectId === p.id));
          return (
            <Card key={p.id} className="pd-rise" style={{ padding: 22, cursor: "pointer" }} onClick={() => openProject(p.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>{c?.name}</div>
                </div>
                {p.locked && <Lock size={13} style={{ color: T.ink3, flexShrink: 0, marginTop: 3 }} />}
              </div>
              <SandStackColumn stack={stack} theme={c?.theme ?? theme} height={130} />
            </Card>
          );
        })}
      </div>

      {attention > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionHead title="Danger loop — overdue & retrying" />
          <div style={{ display: "grid", gap: 10 }}>
            {[...overdue, ...retrying].map((t) => {
              const p = projects.find((x) => x.id === t.projectId);
              const m = members.find((x) => x.id === t.assigneeId);
              const meta = STATE_META[t.state];
              return (
                <Card key={t.id} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
                  onClick={() => openProject(t.projectId)} className="pd-rise">
                  <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                      {p?.name} · {m ? m.name : "Unassigned"}{t.retryCount > 0 && ` · ${t.retryCount} failed attempt${t.retryCount > 1 ? "s" : ""}`}
                    </div>
                  </div>
                  <ChevronRight size={15} style={{ color: T.ink3 }} />
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================= PROJECTS LIST ============================== */
const ProjectsList = ({ projects, companies, engine, onOpen, onEdit, onDelete, onReorder, onCreate }) => (
  <div className="pd-fade-in">
    <PageHead kicker="Execution" title="Projects"
      sub={companies.length === 0
        ? "Add a company first — every project has to live under one."
        : "Deadlines lock permanently once committed — the supervisor never renegotiates."}
      action={<Btn onClick={onCreate} disabled={companies.length === 0}><Plus size={15} /> New project</Btn>} />
    {projects.length === 0 ? (
      <Empty text="No projects in this scope yet." />
    ) : (
      <DragQueueList items={projects} orderKey="sortOrder" onReorder={onReorder}
        renderItem={(p) => (
          <ProjectRow project={p} company={companies.find((x) => x.id === p.companyId)} engine={engine}
            onOpen={() => onOpen(p)} onEdit={() => onEdit(p)} onDelete={() => onDelete(p)} />
        )} />
    )}
  </div>
);

const ProjectRow = ({ project: p, company: c, engine, onOpen, onEdit, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const stack = computeSandStack(p, engine.tasks.filter((t) => t.projectId === p.id));
  return (
    <Card className="pd-rise" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={onOpen}>
        <GripVertical size={14} style={{ color: T.ink3, flexShrink: 0, cursor: "grab" }} onClick={(e) => e.stopPropagation()} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, display: "flex", alignItems: "center", gap: 8 }}>
            {p.name} {p.locked && <Lock size={12} style={{ color: T.ink3 }} />}
          </div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>{c?.name} · due {p.deadline}</div>
        </div>
        <SandBar stack={stack} theme={c?.theme ?? THEME_PRESETS[0]} />
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <IconBtn label="Edit project" onClick={onEdit}><Pencil size={13} /></IconBtn>
          <IconBtn label="Delete project" danger onClick={() => setConfirming(true)}><Trash2 size={13.5} /></IconBtn>
        </div>
        <ChevronRight size={15} style={{ color: T.ink3 }} />
      </div>
      {confirming && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12,
          background: T.dangerBg, border: `1px solid ${T.dangerLine}` }} onClick={(e) => e.stopPropagation()}>
          <span style={{ flex: 1, fontSize: 11.5, color: T.danger }}>Remove "{p.name}"? Tasks keep their history.</span>
          <Btn small ghost onClick={() => setConfirming(false)}>Cancel</Btn>
          <Btn small danger onClick={onDelete}>Confirm</Btn>
        </div>
      )}
    </Card>
  );
};

/* ---------------------------- DRAG-TO-REORDER QUEUE ------------------------
 * Generic — used for the project pipeline above (orderKey="queueOrder") and
 * the personal "My Queue" dashboard panel (orderKey="personalQueueOrder").
 * Plain HTML5 drag events, no dependency, in the same hand-rolled-pointer
 * spirit as NotificationRow's swipe-to-dismiss elsewhere in this file.
 * Dropping a row moves the dragged item to just above the drop target; the
 * new order value is the midpoint between that target and its own previous
 * neighbor (see betweenQueueOrder), so nothing else in the list is touched. */
const DragQueueList = ({ items, orderKey, onReorder, renderItem }) => {
  const dragIdRef = useRef(null);
  const [overId, setOverId] = useState(null);
  const sorted = [...items].sort((a, b) => (a[orderKey] ?? Infinity) - (b[orderKey] ?? Infinity));

  const handleDrop = (targetId) => {
    const draggedId = dragIdRef.current;
    dragIdRef.current = null;
    setOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const withoutDragged = sorted.filter((x) => x.id !== draggedId);
    const insertAt = withoutDragged.findIndex((x) => x.id === targetId);
    if (insertAt === -1) return;
    const prev = withoutDragged[insertAt - 1];
    const next = withoutDragged[insertAt];
    onReorder(draggedId, betweenQueueOrder(prev?.[orderKey] ?? null, next?.[orderKey] ?? null));
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sorted.map((item) => (
        <div key={item.id}
          draggable
          onDragStart={(e) => { dragIdRef.current = item.id; e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={(e) => { e.preventDefault(); if (overId !== item.id) setOverId(item.id); }}
          onDragLeave={() => setOverId((id) => (id === item.id ? null : id))}
          onDrop={(e) => { e.preventDefault(); handleDrop(item.id); }}
          style={{
            borderRadius: 14,
            boxShadow: overId === item.id && dragIdRef.current !== item.id ? `0 0 0 2px ${T.limeDeep}` : "none",
            opacity: dragIdRef.current === item.id ? 0.5 : 1,
          }}>
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
};

/* ============================ PROJECT DETAIL ============================== */
const ProjectDetail = ({ project, companies, members, groups, engine, onBack, tryTransition, attemptDelete, onReassign, onReschedule, onMark, onComplete, onReorder, onAddTask, onExport, onShareToBoard }) => {
  const isMobile = useIsMobile();
  const c = companies.find((x) => x.id === project.companyId);
  const theme = c?.theme ?? THEME_PRESETS[0];
  const tasks = engine.tasks.filter((t) => t.projectId === project.id);
  const openTasks = tasks.filter((t) => t.state !== "completed");
  const completedTasks = tasks.filter((t) => t.state === "completed")
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const stack = computeSandStack(project, tasks);
  const reflections = engine.reflections.filter((r) => r.projectId === project.id);
  const history = engine.transitions.filter((tr) => tasks.some((t) => t.id === tr.taskId)).slice(-6).reverse();
  return (
    /* position: relative + MoldAmbient painted first is what makes "apply
     * the [degraded] effect to the entire UI when in that specific project
     * section" true — the whole page, not just the sand stack widget, reads
     * as being in trouble. */
    <div className="pd-fade-in" style={{ position: "relative" }}>
      {stack.degraded && <MoldAmbient />}
      <div style={{ position: "relative" }}>
      <button onClick={onBack} className="pd-press" style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18, cursor: "pointer",
        background: "none", border: "none", fontSize: 12.5, fontWeight: 600, color: T.ink3, padding: 0,
      }}><ChevronLeft size={14} /> All projects</button>

      <PageHead kicker={c?.name ?? ""} title={project.name}
        sub={<>
          {project.type === "zero_to_one" ? "Zero → One" : `Ongoing · baseline ${project.baseline}%`} · due {project.deadline}
          {project.locked && <span style={{ marginLeft: 8 }}><Chip><Lock size={10} /> Deadline locked</Chip></span>}
        </>}
        action={<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn ghost onClick={onExport}><Download size={14} /> Export report</Btn>
          <Btn onClick={onAddTask}><Plus size={15} /> Add task</Btn>
        </div>} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 300px) 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT — the sand stack + permanent record */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card style={{ padding: 20 }}>
            <SandStackColumn stack={stack} theme={theme} height={280} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 11.5, color: T.ink3 }}>
              <span className="pd-num">{stack.completedWeight}/{stack.totalWeight} weight done</span>
              <span className="pd-num">{tasks.filter((t) => t.state === "completed").length}/{tasks.length} tasks</span>
            </div>
          </Card>

          {reflections.length > 0 && (
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <ScrollText size={14} style={{ color: T.ink3 }} />
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Permanent reflections</span>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {reflections.map((r) => {
                  const t = engine.tasks.find((x) => x.id === r.taskId);
                  return (
                    <div key={r.id} style={{ padding: "12px 14px", borderRadius: 12, background: "#FDF9EF", border: "1px solid #EFE3C8" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#78350F", marginBottom: 6 }}>{t?.title ?? "Task"}</div>
                      {[["Went wrong", r.whatWentWrong], ["Bottleneck", r.rootBottleneck], ["Corrective", r.correctiveAction]].map(([k, v]) => (
                        <div key={k} style={{ fontSize: 11.5, color: T.ink2, lineHeight: 1.55, marginTop: 3 }}>
                          <strong style={{ color: T.ink }}>{k}:</strong> {v}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {history.length > 0 && (
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <History size={14} style={{ color: T.ink3 }} />
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Audit trail</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {history.map((h) => (
                  <div key={h.id} style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5 }}>
                    <span style={{ color: T.ink2, fontWeight: 600 }}>{h.event.replace(/_/g, " ").toLowerCase()}</span>
                    {" · "}{STATE_META[h.from].label} → {STATE_META[h.to].label}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT — tasks with state-machine actions. Drag-reordered by
          * queue_order (item 2) — this project's own pipeline order, e.g.
          * R.M. cutting → CNC machining, independent of who's assigned each
          * step. Dropping a row moves it to just above the one it's dropped
          * on. Completed tasks (item 15) drop out of the pipeline entirely
          * and collapse under their own section below, dulled and sorted
          * most-recent-first — done work stops competing for attention with
          * what's still open. */}
        <div>
          {openTasks.length > 1 && (
            <p style={{ margin: "0 0 8px", fontSize: 11, color: T.ink3 }}>
              <GripVertical size={11} style={{ verticalAlign: -1 }} /> Drag to reorder this project's pipeline — completing one auto-starts the next.
            </p>
          )}
          <DragQueueList items={openTasks} orderKey="queueOrder"
            onReorder={(taskId, queueOrder) => onReorder(taskId, { queueOrder })}
            renderItem={(t) => (
              <TaskRow t={t} members={members} groups={groups}
                tryTransition={tryTransition} attemptDelete={attemptDelete}
                onReassign={onReassign} onReschedule={onReschedule} onMark={onMark} onComplete={onComplete}
                onShareToBoard={onShareToBoard}
                hasReflection={engine.reflections.some((r) => r.taskId === t.id)} />
            )} />
          {openTasks.length === 0 && completedTasks.length === 0 && <Empty text="No tasks yet — add the first one." />}
          {completedTasks.length > 0 && (
            <CompletedTasksSection tasks={completedTasks} members={members} groups={groups}
              tryTransition={tryTransition} attemptDelete={attemptDelete}
              onReassign={onReassign} onReschedule={onReschedule} onMark={onMark} onComplete={onComplete}
              onShareToBoard={onShareToBoard} reflections={engine.reflections} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

/* ------------------------------- TASK ROW --------------------------------- */
const TaskRow = ({ t, members, groups, tryTransition, attemptDelete, onReassign, onReschedule, onMark, onComplete, onShareToBoard, hasReflection }) => {
  const [notesOpen, setNotesOpen] = useState(false);
  const meta = STATE_META[t.state];
  const acts = [];
  if (TRANSITIONS[t.state].START) acts.push({ k: "START", label: "Start", icon: Play, run: () => tryTransition(t.id, "START") });
  if (TRANSITIONS[t.state].COMPLETE) acts.push({
    k: "COMPLETE", icon: Check, run: () => onComplete(t),
    label: t.state === "overdue" ? (hasReflection ? "Complete (late)" : "Complete — reflection first") : "Complete",
  });
  if (TRANSITIONS[t.state].PAUSE) acts.push({ k: "PAUSE", label: "Pause", icon: Pause, run: () => tryTransition(t.id, "PAUSE") });
  if (TRANSITIONS[t.state].FAIL_ATTEMPT) acts.push({ k: "FAIL", label: "No answer / failed", icon: PhoneMissed, run: () => tryTransition(t.id, "FAIL_ATTEMPT", { note: "Attempt failed" }) });
  if (TRANSITIONS[t.state].REASSIGN) acts.push({ k: "REASSIGN", label: "Reassign", icon: UserCheck, run: () => onReassign(t) });
  if (TRANSITIONS[t.state].RESCHEDULE) acts.push({ k: "RESCHEDULE", label: "Reschedule", icon: CalendarClock, run: () => onReschedule(t) });

  return (
    <Card style={{
      padding: "16px 18px",
      borderLeft: `3px solid ${t.state === "overdue" ? "#DC2626" : t.state === "retry_pending" ? "#D97706" : t.state === "completed" ? "#84CC16" : T.line}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <GripVertical size={14} style={{ color: T.ink3, marginTop: 3, flexShrink: 0, cursor: "grab" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: t.state === "completed" ? T.ink3 : T.ink,
              textDecoration: t.state === "completed" ? "line-through" : "none" }}>{t.title}</span>
            <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
            {t.scope === "team" && <Chip bg="#EAF6FE" color="#0284C7"><Users size={10} /> Team</Chip>}
            {t.isMarked && <Chip bg="#FDF3E3" color="#B45309"><Star size={10} /> Marked</Chip>}
            {t.completedLate && <Chip bg="#FDF3E3" color="#B45309">Completed late</Chip>}
            {t.completionPhotoPath && (
              <button type="button" className="pd-press" onClick={async (e) => {
                e.stopPropagation();
                try {
                  const urls = await db.signMediaUrls([t.completionPhotoPath], 3600, "task-media");
                  const url = urls[t.completionPhotoPath];
                  if (url) window.open(url, "_blank", "noopener");
                } catch { /* signing failed — nothing to open */ }
              }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <Chip bg="#EAF6FE" color="#0284C7"><Camera size={10} /> View photo</Chip>
              </button>
            )}
            {t.retryCount > 0 && t.state !== "completed" && <Chip>{t.retryCount} failed attempt{t.retryCount > 1 ? "s" : ""}</Chip>}
            {t.state === "in_progress" && <TaskDurationBadge task={t} />}
          </div>
          <div className="pd-num" style={{ fontSize: 11.5, color: T.ink3, marginTop: 5 }}>
            {taskAudience(t, members, groups)}{t.deadline ? ` · due ${t.deadline}` : ""} · weight {t.weight}
            {t.estimatedMinutes ? ` · est. ${t.estimatedMinutes} min` : ""}
            {t.isMarked && t.markLabel ? ` · ${t.markLabel}` : ""}
          </div>
        </div>
        <IconBtn onClick={() => setNotesOpen((o) => !o)} label={notesOpen ? "Hide notes" : "Task notes"}>
          <StickyNote size={13.5} style={notesOpen ? { color: T.limeDeep } : undefined} />
        </IconBtn>
        <IconBtn onClick={() => onMark(t)} label={t.isMarked ? "Edit calendar mark" : "Mark on calendar"}>
          <Star size={13.5} style={t.isMarked ? { color: "#D97706", fill: "#D97706" } : undefined} />
        </IconBtn>
        <IconBtn onClick={() => attemptDelete(t)} label={t.state === "completed" ? "Archive task" : "Delete (will be refused)"} danger>
          <Trash2 size={13.5} />
        </IconBtn>
      </div>
      {acts.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {acts.map(({ k, label, icon: Icon, run }) => (
            <Btn key={k} small ghost={k !== "COMPLETE"} onClick={run}>
              <Icon size={13} /> {label}
            </Btn>
          ))}
        </div>
      )}
      {notesOpen && <TaskNotesPanel task={t} onShareToBoard={onShareToBoard} />}
    </Card>
  );
};

/* ----------------------------- TASK NOTES (item 10) -------------------------
 * A running log per task — optionally with a photo — separate from the
 * one-line title. Lazy-loaded the moment the panel opens, not fetched for
 * every task up front (a project can have dozens of tasks, most with no
 * notes at all). "Share to board" posts the latest note (or the task title,
 * if there isn't one yet) to that project's board — the "tell the team"
 * half of this feature. */
const TaskNotesPanel = ({ task, onShareToBoard }) => {
  const [notes, setNotes] = useState(null); // null = still loading
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    db.fetchTaskNotes(task.id).then((ns) => { if (!cancelled) setNotes(ns); }).catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [task.id]);

  const submit = async () => {
    if (busy || (!draft.trim() && !file)) return;
    setBusy(true);
    try {
      const photoPath = file ? await db.uploadTaskNotePhoto(task.id, file) : null;
      const note = await db.insertTaskNote({ taskId: task.id, projectId: task.projectId, body: draft.trim(), photoPath });
      setNotes((ns) => [...(ns ?? []), note]);
      setDraft(""); setFile(null);
    } catch { /* left in the draft so nothing typed is lost; no toast plumbing this deep */ }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.lineSoft}` }} onClick={(e) => e.stopPropagation()}>
      {notes === null ? (
        <div style={{ fontSize: 11.5, color: T.ink3 }}>Loading notes…</div>
      ) : (
        <>
          {notes.length === 0 ? (
            <div style={{ fontSize: 11.5, color: T.ink3, marginBottom: 8 }}>No notes yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ fontSize: 12, color: T.ink2, lineHeight: 1.55 }}>
                  <span className="pd-num" style={{ color: T.ink3, fontWeight: 600 }}>{relativeTime(n.at)}</span>
                  {n.body && <span> — {n.body}</span>}
                  {n.photoPath && (
                    <button type="button" className="pd-press" onClick={async () => {
                      try {
                        const urls = await db.signMediaUrls([n.photoPath], 3600, "task-notes");
                        const url = urls[n.photoPath];
                        if (url) window.open(url, "_blank", "noopener");
                      } catch { /* signing failed — nothing to open */ }
                    }} style={{ background: "none", border: "none", padding: 0, marginLeft: 7, cursor: "pointer", color: T.limeDeep, fontSize: 11 }}>
                      <Camera size={10} style={{ verticalAlign: -1 }} /> photo
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, minHeight: 34, flex: 1, minWidth: 140, fontSize: 12 }} value={draft}
              placeholder="Add a note…" onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            <label className="pd-press" title={file ? file.name : "Attach a photo"} style={{
              display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, cursor: "pointer",
              border: `1px solid ${T.line}`, background: file ? "#F4FBE3" : T.card, flexShrink: 0,
            }}>
              <Paperclip size={13} style={{ color: file ? T.limeDeep : T.ink3 }} />
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files[0] ?? null)} />
            </label>
            <Btn small disabled={busy || (!draft.trim() && !file)} onClick={submit}>Add</Btn>
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn small ghost onClick={() => onShareToBoard(task, notes[notes.length - 1]?.body)}>
              <Send size={12} /> Share to board
            </Btn>
          </div>
        </>
      )}
    </div>
  );
};

/* ------------------------- COMPLETED TASKS (item 15) -----------------------
 * Collapsed by default — done work shouldn't compete with what's still open
 * for the same visual attention, but the full history stays one click away
 * rather than disappearing. */
const CompletedTasksSection = ({ tasks, members, groups, tryTransition, attemptDelete, onReassign, onReschedule, onMark, onComplete, onShareToBoard, reflections }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="pd-press" style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", borderRadius: 12,
        background: T.cardSoft, border: `1px solid ${T.lineSoft}`, cursor: "pointer",
        fontSize: 12.5, fontWeight: 600, color: T.ink2,
      }}>
        <ChevronDown size={14} style={{ transition: "transform 150ms", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
        Completed ({tasks.length})
      </button>
      {open && (
        <div style={{ display: "grid", gap: 10, marginTop: 10, opacity: 0.72 }}>
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} members={members} groups={groups}
              tryTransition={tryTransition} attemptDelete={attemptDelete}
              onReassign={onReassign} onReschedule={onReschedule} onMark={onMark} onComplete={onComplete}
              onShareToBoard={onShareToBoard}
              hasReflection={reflections.some((r) => r.taskId === t.id)} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------ TASK FORM --------------------------------- */
const TaskForm = ({ projectId, members, groups, companies, myMemberId, onCreateGroup, onSave, onClose }) => {
  const [f, setF] = useState({
    title: "", scope: "individual", assigneeId: members[0]?.id ?? "",
    assigneeGroupId: groups[0]?.id ?? "", deadline: "", weight: 1, estimatedMinutes: "",
  });
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const team = f.scope === "team";
  const createGroup = () => {
    if (!newGroupName.trim()) return;
    const g = onCreateGroup(newGroupName.trim());
    setF({ ...f, assigneeGroupId: g.id });
    setNewGroupName("");
    setAddingGroup(false);
  };
  return (
    <Modal title="Add task" subtitle="A new grain for the stack" onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Title</Label>
          <input style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call vendor for quotation" /></div>

        {/* Individual vs team is a two-button choice rather than a dropdown —
          * it changes which assignee field is shown below it, and a visible
          * switch makes that consequence obvious. */}
        <div>
          <Label>Task type</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { key: "individual", label: "Individual", icon: UserCheck, hint: "One person owns it" },
              { key: "team", label: "Team", icon: Users, hint: "A group owns it together" },
            ].map(({ key, label, icon: Icon, hint }) => {
              const on = f.scope === key;
              return (
                <button key={key} type="button" onClick={() => setF({ ...f, scope: key })} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderRadius: 11,
                  cursor: "pointer", textAlign: "left",
                  background: on ? "#F4FBE3" : T.card, border: `1px solid ${on ? "#C9E88A" : T.line}`,
                }}>
                  <Icon size={15} style={{ color: on ? T.limeDeep : T.ink3, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: on ? 600 : 450, color: T.ink }}>{label}</div>
                    <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>{hint}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* item 12 — a searchable, department-sorted picker instead of a bare
          * <select> a big roster turns into a scroll hunt, plus a one-click
          * self-assign. Team tasks keep the lighter group dropdown (a
          * handful of departments never needed search), with an inline
          * "+ New group" so assigning to a department that doesn't exist yet
          * doesn't mean leaving this form first. */}
        {team ? (
          <div>
            <Label>Group</Label>
            <select style={inputStyle} value={f.assigneeGroupId} onChange={(e) => setF({ ...f, assigneeGroupId: e.target.value })}>
              <option value="">Whole team</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {addingGroup ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input autoFocus style={{ ...inputStyle, minHeight: 36, flex: 1 }} value={newGroupName}
                  placeholder="New group name" onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createGroup()} />
                <Btn small disabled={!newGroupName.trim()} onClick={createGroup}>Create</Btn>
                <Btn small ghost onClick={() => { setAddingGroup(false); setNewGroupName(""); }}>Cancel</Btn>
              </div>
            ) : (
              <button type="button" onClick={() => setAddingGroup(true)} className="pd-press" style={{
                marginTop: 7, background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: 11.5, fontWeight: 600, color: T.limeDeep, display: "inline-flex", alignItems: "center", gap: 5,
              }}><Plus size={11} /> New group</button>
            )}
          </div>
        ) : (
          <div><Label>Assignee</Label>
            <MemberPickerList members={members} groups={groups} companies={companies}
              value={f.assigneeId} onChange={(id) => setF({ ...f, assigneeId: id })} myMemberId={myMemberId} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <div><Label>Deadline</Label>
            <input type="date" style={inputStyle} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
          <div><Label>Weight (1–10)</Label>
            <input type="number" min={1} max={10} style={inputStyle} value={f.weight}
              onChange={(e) => setF({ ...f, weight: Math.max(1, Math.min(10, +e.target.value || 1)) })} /></div>
          <div><Label>Est. duration (min, optional)</Label>
            <input type="number" min={1} style={inputStyle} value={f.estimatedMinutes} placeholder="e.g. 18"
              onChange={(e) => setF({ ...f, estimatedMinutes: e.target.value })} /></div>
        </div>
        {/* item 20 — weight otherwise looks like a mystery number; this is
          * the one line that explains what it actually drives. */}
        <p style={{ margin: 0, fontSize: 11.5, color: T.ink3, lineHeight: 1.55 }}>
          <strong style={{ color: T.ink2 }}>Weight</strong> sets how much this task fills the project's
          progress bar once completed, relative to its other tasks — 1 is a light task, 10 is a major
          milestone. It doesn't affect anything else (assignment, ordering, or the calendar).
        </p>
        {team && (
          <p style={{ margin: 0, fontSize: 11.5, color: T.ink3, lineHeight: 1.55 }}>
            A team task can still be handed to one person to execute — reassigning it does not
            change it back into individual work, so month-end reporting keeps counting it as team output.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.title.trim()} onClick={() => onSave({
            id: "t-" + uid(), projectId, title: f.title.trim(), state: "pending",
            scope: f.scope,
            assigneeId: team ? null : (f.assigneeId || null),
            assigneeGroupId: team ? (f.assigneeGroupId || null) : null,
            deadline: f.deadline || null, weight: f.weight,
            estimatedMinutes: f.estimatedMinutes ? Math.max(1, +f.estimatedMinutes) : null,
            retryCount: 0, completedAt: null, completedLate: false,
            isMarked: false, markLabel: "", markScope: null, markTargetId: null,
          })}><Check size={15} /> Add task</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------ PROJECT FORM ------------------------------ */
const ProjectForm = ({ data, companies, defaultCompanyId, onSave, onClose }) => {
  /* item 3/19 — when you're already scoped into one company, a new project
   * can only ever be its project; editing an existing one still lets you
   * move it between companies deliberately. */
  const lockedToCompany = !data && defaultCompanyId !== "all";
  const [f, setF] = useState(data ?? {
    name: "", companyId: defaultCompanyId !== "all" ? defaultCompanyId : (companies[0]?.id ?? ""),
    type: "zero_to_one", baseline: 0, deadline: "", locked: false,
  });
  const locked = data?.locked;
  return (
    <Modal title={data ? "Edit project" : "New project"} wide onClose={onClose}
      subtitle={locked ? "Deadline & baseline are locked — immutable by design" : "Phases instantiate from the company template"}>
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Project name</Label>
          <input style={inputStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Company{lockedToCompany && " · scoped to the company you're viewing"}</Label>
            <select style={{ ...inputStyle, opacity: lockedToCompany ? 0.6 : 1 }} disabled={lockedToCompany}
              value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              {companies.length === 0 && <option value="">Add a company first</option>}
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} disabled={locked}
              onChange={(e) => setF({ ...f, type: e.target.value, baseline: e.target.value === "zero_to_one" ? 0 : f.baseline })}>
              <option value="zero_to_one">Zero → One (starts empty)</option>
              <option value="ongoing">Ongoing (has baseline)</option>
            </select></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Deadline {locked && "· locked"}</Label>
            <input type="date" style={{ ...inputStyle, opacity: locked ? 0.5 : 1 }} disabled={locked}
              value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
          <div><Label>Baseline % {locked && "· locked"}</Label>
            <input type="number" min={0} max={100} style={{ ...inputStyle, opacity: f.type === "zero_to_one" || locked ? 0.5 : 1 }}
              disabled={f.type === "zero_to_one" || locked} value={f.baseline}
              onChange={(e) => setF({ ...f, baseline: Math.min(100, Math.max(0, +e.target.value || 0)) })} /></div>
        </div>
        {!locked && (
          <button onClick={() => setF({ ...f, locked: !f.locked })} className="pd-press" style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, cursor: "pointer", textAlign: "left",
            background: f.locked ? "#F4FBE3" : T.cardSoft, border: `1px solid ${f.locked ? "#C9E88A" : T.line}`,
          }}>
            <Lock size={16} style={{ color: f.locked ? T.limeDeep : T.ink3 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{f.locked ? "Will lock on save" : "Lock deadline & baseline"}</div>
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>One-way. No code path can undo it.</div>
            </div>
          </button>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.name.trim() || !f.companyId} onClick={() => onSave(f)}>
            <Check size={15} /> {data ? "Save" : "Create project"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

/* =============================== COMPANIES ================================= */
const CompaniesView = ({ companies, projects, members, onAdd, onEdit, onDelete, onEnter, onReorder }) => (
  <div className="pd-fade-in">
    <PageHead kicker="Root entity" title="Companies"
      sub="Every project and team member is scoped to a company. Click a card to work inside it — drag to reorder."
      action={<Btn onClick={onAdd}><Plus size={15} /> Add company</Btn>} />
    {companies.length === 0 ? (
      <Empty text="No companies yet — add the first one." />
    ) : (
      <DragQueueList items={companies} orderKey="sortOrder" onReorder={onReorder}
        renderItem={(c) => (
          <CompanyCard company={c}
            projectCount={projects.filter((p) => p.companyId === c.id).length}
            memberCount={members.filter((m) => m.companyIds.includes(c.id)).length}
            onEdit={() => onEdit(c)} onDelete={() => onDelete(c)} onEnter={() => onEnter(c)} />
        )} />
    )}
  </div>
);

const CompanyCard = ({ company: c, projectCount, memberCount, onEdit, onDelete, onEnter }) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className="pd-rise" onClick={confirming ? undefined : onEnter}
      style={{ padding: 22, display: "flex", flexDirection: "column", gap: 15, cursor: confirming ? "default" : "pointer" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <GripVertical size={14} style={{ color: T.ink3, flexShrink: 0, marginTop: 17, cursor: "grab" }} />
        <Mesh mesh={c.theme.mesh} style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowSm }}>
          <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Building2 size={20} style={{ color: c.theme.ink }} />
          </div>
        </Mesh>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}>{c.name}</h3>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>{c.industry || "—"}</div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 1 }}>{c.location || "—"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <IconBtn label="Edit company" onClick={onEdit}><Pencil size={13} /></IconBtn>
          <IconBtn label="Delete company" danger onClick={() => setConfirming(true)}><Trash2 size={13.5} /></IconBtn>
        </div>
      </div>
      {confirming ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12,
          background: T.dangerBg, border: `1px solid ${T.dangerLine}` }} onClick={(e) => e.stopPropagation()}>
          <span style={{ flex: 1, fontSize: 11.5, color: T.danger }}>Remove {c.name}? Projects/members keep their history.</span>
          <Btn small ghost onClick={() => setConfirming(false)}>Cancel</Btn>
          <Btn small danger onClick={onDelete}>Confirm</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <Chip>{projectCount} project{projectCount !== 1 ? "s" : ""}</Chip>
          <Chip>{memberCount} member{memberCount !== 1 ? "s" : ""}</Chip>
        </div>
      )}
    </Card>
  );
};

/* ------------------------------ COLOR PICKER -------------------------------
 * item 5 — the 12-preset grid plus a native color-input swatch that derives
 * a full theme from whatever hex you pick (deriveThemeFromHex above). Shared
 * between a company's own theme (here) and the per-workspace personal
 * accent picker below — one color model, two use sites. */
const ColorPicker = ({ value, onChange }) => {
  const isCustom = value?.key === "custom";
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      {THEME_PRESETS.map((t) => {
        const on = !isCustom && value?.key === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t)} className="pd-press" title={t.label} style={{
            cursor: "pointer", padding: 3, borderRadius: 14,
            border: `2px solid ${on ? t.primary : "transparent"}`, background: "none",
          }}>
            <Mesh mesh={t.mesh} style={{ width: 40, height: 40, borderRadius: 11, border: "1px solid rgba(22,24,29,0.07)" }} />
          </button>
        );
      })}
      <label className="pd-press" title="Custom color" style={{
        cursor: "pointer", padding: 3, borderRadius: 14, display: "inline-flex",
        border: `2px solid ${isCustom ? value.primary : "transparent"}`,
      }}>
        <div style={{
          position: "relative", width: 40, height: 40, borderRadius: 11, overflow: "hidden",
          border: "1px solid rgba(22,24,29,0.07)", display: "grid", placeItems: "center",
          background: isCustom ? value.primary : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
        }}>
          {!isCustom && <Palette size={16} style={{ color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))" }} />}
          <input type="color" value={isCustom ? value.primary : "#7CB518"}
            onChange={(e) => onChange(deriveThemeFromHex(e.target.value))}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%", border: "none", padding: 0 }} />
        </div>
      </label>
    </div>
  );
};

const CompanyForm = ({ data, onSave, onClose }) => {
  const [f, setF] = useState(data
    ? { ...data, industry: data.industry ?? "", location: data.location ?? "" }
    : { name: "", industry: "", location: "", theme: THEME_PRESETS[0] });
  return (
    <Modal title={data ? "Edit company" : "Add company"} onClose={onClose}
      subtitle="The theme sets this company's color everywhere it appears.">
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Company name</Label>
          <input style={inputStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Industry</Label>
            <input style={inputStyle} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></div>
          <div><Label>Location</Label>
            <input style={inputStyle} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        </div>
        <div>
          <Label>Theme</Label>
          <ColorPicker value={f.theme} onChange={(theme) => setF({ ...f, theme })} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.name.trim()} onClick={() => onSave(f)}><Check size={15} /> {data ? "Save" : "Add company"}</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ================================= TEAM =================================== */
const TeamView = ({ members, companies, groups, engine, memberships, myMemberId, onAddMember, onEditMember, onDeleteMember, onManageGroups, onWhisper }) => {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const buckets = [
    ...sortedGroups.map((g) => ({ id: g.id, label: g.name, members: members.filter((m) => m.groupId === g.id) })),
    { id: null, label: "Ungrouped", members: members.filter((m) => !m.groupId || !groups.some((g) => g.id === m.groupId)) },
  ].filter((b) => b.members.length > 0);
  /* item 8 — whisper only makes sense for someone who can actually sign in
   * and read a reply; a roster entry with no linked account never can. */
  const linkedMemberIds = new Set(memberships.filter((m) => m.userId).map((m) => m.memberId));
  return (
    <div className="pd-fade-in">
      <PageHead kicker="Resource pool" title="Team"
        sub="Delegation and follow-ups route through these people. Open handoffs are tracked until answered."
        action={<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn ghost onClick={onManageGroups}><Tag size={14} /> Manage groups</Btn>
          <Btn onClick={onAddMember}><Plus size={15} /> Add member</Btn>
        </div>} />
      {members.length === 0 && <Empty text="No team members yet — add the first one." />}
      {buckets.map((b) => (
        <div key={b.id ?? "ungrouped"} style={{ marginBottom: 28 }}>
          <SectionHead title={`${b.label} · ${b.members.length}`} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 16 }}>
            {b.members.map((m) => (
              <MemberCard key={m.id} m={m} companies={companies} engine={engine}
                canWhisper={m.id !== myMemberId && linkedMemberIds.has(m.id)}
                onWhisper={() => onWhisper(m)}
                onEdit={() => onEditMember(m)} onDelete={() => onDeleteMember(m)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const MemberCard = ({ m, companies, engine, canWhisper, onWhisper, onEdit, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const firstCo = companies.find((c) => c.id === m.companyIds[0]);
  const theme = firstCo?.theme ?? THEME_PRESETS[0];
  const initials = m.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const myOpen = engine.handoffs.filter((h) => h.status === "pending" && h.toAssigneeId === m.id);
  const myTasks = engine.tasks.filter((t) => t.assigneeId === m.id && t.state !== "completed");
  return (
    <Card className="pd-rise" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 15 }}>
      <div style={{ display: "flex", gap: 15, alignItems: "flex-start" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Mesh mesh={theme.mesh} style={{ width: 56, height: 56, borderRadius: 17,
            border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowSm }}>
            <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 19, color: theme.ink,
              display: "grid", placeItems: "center", height: "100%" }}>{initials}</span>
          </Mesh>
          {m.defaultDelegate && (
            <div title="Default delegate" style={{ position: "absolute", bottom: -5, right: -5, width: 21, height: 21,
              borderRadius: 8, display: "grid", placeItems: "center", background: "#FFF",
              border: `1px solid ${theme.primary}55`, boxShadow: T.shadowSm }}>
              <ShieldCheck size={12} style={{ color: theme.primary }} /></div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}>{m.name}</h3>
            {m.external && <Chip><Globe size={10} /> External</Chip>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {m.roles.map((r) => <Chip key={r} accent={theme.primary}>{r}</Chip>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {canWhisper && <IconBtn label="Message privately" onClick={onWhisper}><MessageCircle size={13} /></IconBtn>}
          <IconBtn label="Edit member" onClick={onEdit}><Pencil size={13} /></IconBtn>
          <IconBtn label="Delete member" danger onClick={() => setConfirming(true)}><Trash2 size={13.5} /></IconBtn>
        </div>
      </div>
      {confirming ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12,
          background: T.dangerBg, border: `1px solid ${T.dangerLine}` }}>
          <span style={{ flex: 1, fontSize: 11.5, color: T.danger }}>Remove {m.name}? Past task history is kept.</span>
          <Btn small ghost onClick={() => setConfirming(false)}>Cancel</Btn>
          <Btn small danger onClick={onDelete}>Confirm</Btn>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 7, padding: "12px 14px", borderRadius: 13, background: T.cardSoft, border: `1px solid ${T.lineSoft}` }}>
            <span className="pd-num" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.ink2 }}>
              <Phone size={12.5} style={{ color: T.ink3 }} /> {m.phone}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: T.ink2 }}>
              <Mail size={12.5} style={{ color: T.ink3 }} /> {m.email}</span>
          </div>
          {myOpen.length > 0 && (
            <div style={{ padding: "10px 13px", borderRadius: 12, background: "#FDF3E3", border: "1px solid #F0DBB4",
              fontSize: 11.5, fontWeight: 600, color: "#78350F" }}>
              Has {m.name} completed the follow-up? · {myOpen.length} open handoff{myOpen.length > 1 ? "s" : ""}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: "auto" }}>
            {myTasks.length} open task{myTasks.length !== 1 ? "s" : ""} assigned
          </div>
        </>
      )}
    </Card>
  );
};

/* ------------------------------- MEMBER FORM ------------------------------- */
const MemberForm = ({ data, companies, groups, onSave, onClose }) => {
  const [f, setF] = useState(data ?? {
    name: "", roles: [], phone: "", email: "", notes: "",
    external: false, defaultDelegate: false, groupId: null, competesOnLeaderboard: true,
  });
  const [rolesText, setRolesText] = useState((data?.roles ?? []).join(", "));
  const [companyIds, setCompanyIds] = useState(data?.companyIds ?? []);
  const toggleCompany = (id) => setCompanyIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <Modal title={data ? "Edit team member" : "Add team member"} wide onClose={onClose}
      subtitle="Global across companies — link them to whichever businesses they work with.">
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Name</Label>
          <input style={inputStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Roles (comma-separated)</Label>
          <input style={inputStyle} value={rolesText} onChange={(e) => setRolesText(e.target.value)}
            placeholder="e.g. CNC Machining, Fabrication" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Phone</Label>
            <input style={inputStyle} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><Label>Email</Label>
            <input style={inputStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div><Label>Group</Label>
          <select style={inputStyle} value={f.groupId ?? ""} onChange={(e) => setF({ ...f, groupId: e.target.value || null })}>
            <option value="">Ungrouped</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></div>
        <div>
          <Label>Companies</Label>
          <div style={{ display: "grid", gap: 8 }}>
            {companies.map((c) => {
              const on = companyIds.includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggleCompany(c.id)} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11,
                  cursor: "pointer", textAlign: "left",
                  background: on ? "#F4FBE3" : T.card, border: `1px solid ${on ? "#C9E88A" : T.line}`,
                }}>
                  <CircleDot size={11} style={{ color: c.theme.primary }} />
                  <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{c.name}</span>
                  {on && <Check size={14} style={{ color: T.limeDeep }} />}
                </button>
              );
            })}
            {companies.length === 0 && <span style={{ fontSize: 11.5, color: T.ink3 }}>Add a company first.</span>}
          </div>
        </div>
        <div><Label>Notes</Label>
          <textarea rows={2} style={{ ...inputStyle, minHeight: 60, paddingTop: 11, resize: "vertical" }}
            value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
            <input type="checkbox" checked={f.external} onChange={(e) => setF({ ...f, external: e.target.checked })} />
            External / vendor
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
            <input type="checkbox" checked={f.defaultDelegate} onChange={(e) => setF({ ...f, defaultDelegate: e.target.checked })} />
            Default delegate (handoff target)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
            <input type="checkbox" checked={f.competesOnLeaderboard}
              onChange={(e) => setF({ ...f, competesOnLeaderboard: e.target.checked })} />
            Competes on leaderboard
          </label>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: T.ink3, lineHeight: 1.5 }}>
          Turn this off for roster entries who don't have access to Puroductive (the working force)
          so only people actually competing here — the board room force — show up in rankings.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.name.trim()} onClick={() => onSave(
            { ...f, roles: rolesText.split(",").map((r) => r.trim()).filter(Boolean) },
            companyIds,
          )}><Check size={15} /> {data ? "Save" : "Add member"}</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ---------------------------- GROUPS MANAGEMENT ----------------------------- */
const GroupsManageModal = ({ groups, companies, defaultCompanyId, onSave, onDelete, onClose }) => {
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [newName, setNewName] = useState("");
  const [newCompanyId, setNewCompanyId] = useState(defaultCompanyId && defaultCompanyId !== "all" ? defaultCompanyId : "");
  const [confirmId, setConfirmId] = useState(null);
  const startEdit = (g) => { setEditingId(g.id); setEditText(g.name); };
  const commitEdit = (g) => { if (editText.trim()) onSave({ id: g.id, name: editText.trim(), companyId: g.companyId }); setEditingId(null); };
  const companyName = (id) => companies.find((c) => c.id === id)?.name;
  return (
    <Modal title="Manage team groups" onClose={onClose}
      subtitle="Group your team into departments, crews, or vendors — optionally scoped to one company.">
      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        {[...groups].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => (
          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", flexWrap: "wrap",
            borderRadius: 11, border: `1px solid ${T.line}`, background: T.card }}>
            {editingId === g.id ? (
              <input autoFocus style={{ ...inputStyle, minHeight: 34, flex: 1 }} value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitEdit(g)} />
            ) : (
              <div style={{ flex: 1, minWidth: 110 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{g.name}</div>
                <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>{companyName(g.companyId) ?? "Workspace-wide"}</div>
              </div>
            )}
            {editingId !== g.id && confirmId !== g.id && (
              <select value={g.companyId ?? ""} title="Scope this group (and its chat channel) to one company"
                style={{ ...inputStyle, width: "auto", minHeight: 32, fontSize: 11.5, padding: "0 8px" }}
                onChange={(e) => onSave({ id: g.id, name: g.name, companyId: e.target.value || null })}>
                <option value="">Workspace-wide</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {confirmId === g.id ? (
              <>
                <Btn small ghost onClick={() => setConfirmId(null)}>Cancel</Btn>
                <Btn small danger onClick={() => { onDelete(g); setConfirmId(null); }}>Confirm</Btn>
              </>
            ) : editingId === g.id ? (
              <Btn small onClick={() => commitEdit(g)}><Check size={13} /> Save</Btn>
            ) : (
              <>
                <IconBtn label="Rename group" onClick={() => startEdit(g)}><Pencil size={13} /></IconBtn>
                <IconBtn label="Delete group" danger onClick={() => setConfirmId(g.id)}><Trash2 size={13} /></IconBtn>
              </>
            )}
          </div>
        ))}
        {groups.length === 0 && <span style={{ fontSize: 11.5, color: T.ink3 }}>No groups yet.</span>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New group name"
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onSave({ name: newName.trim(), companyId: newCompanyId || null }); setNewName(""); } }} />
        <select value={newCompanyId} style={{ ...inputStyle, width: "auto" }} onChange={(e) => setNewCompanyId(e.target.value)}>
          <option value="">Workspace-wide</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Btn disabled={!newName.trim()} onClick={() => { onSave({ name: newName.trim(), companyId: newCompanyId || null }); setNewName(""); }}>
          <Plus size={15} /> Add
        </Btn>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <Btn ghost onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
};

/* ============================================================================
 * THE BOARD — a workspace feed where posts carry an intent
 * ==========================================================================*/
const BoardView = ({ board, mediaUrls, available, members, projects, companies, myUserId, myMemberId,
  readOnly, onCompose, onComment, onVote, onDelete, onAccept, onDecline, onTogglePin, onOpenProject }) => {
  const [filter, setFilter] = useState("all");

  if (!available) {
    return (
      <div className="pd-fade-in">
        <PageHead kicker="Collaboration" title="Board" />
        <Card style={{ padding: 26 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <AlertTriangle size={18} style={{ color: "#B45309", flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.65 }}>
              The board's tables aren't in your database yet. Run
              <span className="pd-num"> supabase/schema_v5.sql </span>
              once in the Supabase SQL editor and reload — it adds posts, comments, polls and task
              requests, plus the private storage bucket the photos and videos go in.
              <div style={{ marginTop: 8, color: T.ink3, fontSize: 12 }}>
                Everything else in Puroductive keeps working in the meantime.
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const filtered = filter === "all" ? board.posts : board.posts.filter((p) => p.kind === filter);
  /* item 16 — pinned posts float above everything else, under their own
   * divider, so "the team needs to see this" doesn't get buried by whatever
   * was posted most recently. */
  const pinnedPosts = filtered.filter((p) => p.pinned);
  const posts = filtered.filter((p) => !p.pinned);
  /* Requests needing a decision from me float to the top — a board is only
   * useful if the thing waiting on you is the thing you see first. */
  const mine = board.requests.filter((r) => r.status === "pending" && r.assigneeMemberId === myMemberId);

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Collaboration" title="Board"
        sub="Share work, ask for opinions, hand out tasks, run a poll. Every task request keeps a permanent paper trail."
        action={<Btn disabled={readOnly} onClick={onCompose}><Plus size={15} /> New post</Btn>} />

      {mine.length > 0 && (
        <Card soft style={{ padding: "13px 17px", marginBottom: 18, display: "flex", alignItems: "center", gap: 11,
          border: "1px solid #F3D19E", background: "#FFFCF6" }}>
          <UserCheck size={15} style={{ color: "#B45309", flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: T.ink2 }}>
            <strong>{mine.length} task request{mine.length !== 1 ? "s" : ""}</strong> waiting on you below.
          </span>
        </Card>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {[["all", "Everything"], ...Object.entries(POST_KIND_META).map(([k, m]) => [k, m.label])].map(([key, label]) => {
          const on = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} className="pd-press" style={{
              minHeight: 32, padding: "0 13px", borderRadius: 99, cursor: "pointer",
              fontSize: 12, fontWeight: on ? 600 : 450,
              color: on ? "#243305" : T.ink3,
              background: on ? "#EFFCC9" : T.card,
              border: `1px solid ${on ? "#C9E88A" : T.line}`,
            }}>{label}</button>
          );
        })}
      </div>

      {pinnedPosts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 11, fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>
            <Pin size={11} /> Pinned
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {pinnedPosts.map((p) => (
              <PostCard key={p.id} post={p} board={board} mediaUrls={mediaUrls}
                members={members} projects={projects} myUserId={myUserId} myMemberId={myMemberId}
                readOnly={readOnly}
                onComment={onComment} onVote={onVote} onDelete={onDelete}
                onAccept={onAccept} onDecline={onDecline} onTogglePin={onTogglePin} onOpenProject={onOpenProject} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {posts.map((p) => (
          <PostCard key={p.id} post={p} board={board} mediaUrls={mediaUrls}
            members={members} projects={projects} myUserId={myUserId} myMemberId={myMemberId}
            readOnly={readOnly}
            onComment={onComment} onVote={onVote} onDelete={onDelete}
            onAccept={onAccept} onDecline={onDecline} onTogglePin={onTogglePin} onOpenProject={onOpenProject} />
        ))}
        {posts.length === 0 && pinnedPosts.length === 0 && (
          <Empty text={filter === "all"
            ? "Nothing on the board yet — post a photo, ask a question, or hand someone a task."
            : `No ${POST_KIND_META[filter].label.toLowerCase()} posts yet.`} />
        )}
      </div>
    </div>
  );
};

/* ------------------------------- POST CARD -------------------------------- */
const PostCard = ({ post, board, mediaUrls, members, projects, myUserId, myMemberId, readOnly,
  onComment, onVote, onDelete, onAccept, onDecline, onTogglePin, onOpenProject }) => {
  const [draft, setDraft] = useState("");
  const [showTrail, setShowTrail] = useState(false);
  const meta = POST_KIND_META[post.kind] ?? POST_KIND_META.update;
  const Icon = meta.icon;
  const media = board.media.filter((m) => m.postId === post.id);
  const comments = board.comments.filter((c) => c.postId === post.id);
  const request = board.requests.find((r) => r.postId === post.id);
  const author = members.find((m) => m.id === post.authorMemberId);
  const project = projects.find((p) => p.id === post.projectId);
  const isAuthor = post.authorId === myUserId;

  const submit = () => { if (draft.trim()) { onComment(post.id, draft.trim()); setDraft(""); } };

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 18px 12px" }}>
        <div style={{ width: 32, height: 32, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center",
          background: T.bg, border: `1px solid ${T.line}`, fontSize: 12, fontWeight: 600, color: T.ink2 }}>
          {(author?.name ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{author?.name ?? "Someone"}</div>
          <div className="pd-num" style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>
            {new Date(post.at).toLocaleString("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {project ? ` · ${project.name}` : ""}
          </div>
        </div>
        <Chip bg={meta.bg} color={meta.color}><Icon size={10} /> {meta.label}</Chip>
        {!readOnly && (
          <IconBtn label={post.pinned ? "Unpin" : "Pin for the team"} onClick={() => onTogglePin(post)}>
            {post.pinned ? <PinOff size={13} style={{ color: T.limeDeep }} /> : <Pin size={13} />}
          </IconBtn>
        )}
        {isAuthor && !readOnly && (
          <IconBtn label="Delete post" danger onClick={() => onDelete(post)}><Trash2 size={13} /></IconBtn>
        )}
      </div>

      {post.caption && (
        <div style={{ padding: "0 18px 13px", fontSize: 13.5, color: T.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {post.caption}
        </div>
      )}

      {media.length > 0 && <MediaGrid media={media} mediaUrls={mediaUrls} />}

      {post.kind === "poll" && (
        <PollPanel post={post} board={board} myUserId={myUserId} readOnly={readOnly} onVote={onVote} />
      )}

      {request && (
        <TaskRequestPanel request={request} board={board} members={members}
          myMemberId={myMemberId} readOnly={readOnly}
          showTrail={showTrail} onToggleTrail={() => setShowTrail((s) => !s)}
          onAccept={onAccept} onDecline={onDecline} onOpenProject={onOpenProject} />
      )}

      {/* comments — the "what are your thoughts" surface */}
      <div style={{ borderTop: `1px solid ${T.lineSoft}`, padding: "12px 18px 15px", background: T.cardSoft }}>
        {comments.length > 0 && (
          <div style={{ display: "grid", gap: 9, marginBottom: 11 }}>
            {comments.map((c) => {
              const who = members.find((m) => m.id === c.authorMemberId);
              return (
                <div key={c.id} style={{ display: "flex", gap: 9 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center",
                    background: T.card, border: `1px solid ${T.line}`, fontSize: 10, fontWeight: 600, color: T.ink3 }}>
                    {(who?.name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.ink }}>{who?.name ?? "Someone"}</span>
                    <span style={{ fontSize: 12.5, color: T.ink2, marginLeft: 7, lineHeight: 1.55 }}>{c.body}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!readOnly && (
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, minHeight: 36, fontSize: 12.5 }} value={draft}
              placeholder={post.kind === "discussion" ? "Share your thoughts…" : "Add a comment…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <Btn small disabled={!draft.trim()} onClick={submit}><Send size={13} /></Btn>
          </div>
        )}
      </div>
    </Card>
  );
};

/* Signed URLs are minted at load; a missing one means the signature request
 * failed or expired, so say so rather than rendering a broken image icon. */
const MediaGrid = ({ media, mediaUrls }) => (
  <div style={{ display: "grid", gap: 3,
    gridTemplateColumns: media.length === 1 ? "1fr" : "repeat(auto-fit, minmax(160px, 1fr))" }}>
    {media.map((m) => {
      const url = mediaUrls[m.path];
      if (!url) {
        return (
          <div key={m.id} style={{ aspectRatio: "4 / 3", display: "grid", placeItems: "center",
            background: T.bg, color: T.ink3, fontSize: 11.5 }}>
            <span><ImageIcon size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Preview unavailable</span>
          </div>
        );
      }
      return m.mediaType === "video"
        ? <video key={m.id} src={url} controls preload="metadata"
            style={{ width: "100%", maxHeight: 420, objectFit: "cover", background: "#000", display: "block" }} />
        : <img key={m.id} src={url} alt="" loading="lazy"
            style={{ width: "100%", maxHeight: 420, objectFit: "cover", display: "block" }} />;
    })}
  </div>
);

/* --------------------------------- POLL ----------------------------------- */
const PollPanel = ({ post, board, myUserId, readOnly, onVote }) => {
  const options = board.pollOptions.filter((o) => o.postId === post.id);
  const votes = board.pollVotes.filter((v) => v.postId === post.id);
  const myVote = votes.find((v) => v.voterId === myUserId);
  const total = votes.length;
  return (
    <div style={{ padding: "4px 18px 16px", display: "grid", gap: 7 }}>
      {options.map((o) => {
        const count = votes.filter((v) => v.optionId === o.id).length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const on = myVote?.optionId === o.id;
        return (
          <button key={o.id} onClick={() => !readOnly && onVote(post.id, o.id)}
            disabled={readOnly} className="pd-press" style={{
              position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 10,
              minHeight: 40, padding: "0 13px", borderRadius: 10, textAlign: "left",
              cursor: readOnly ? "default" : "pointer",
              border: `1px solid ${on ? "#B3A0F2" : T.line}`, background: T.card,
            }}>
            {/* the fill bar sits behind the label rather than beside it, so a
              * long option name never squeezes the percentage off the row */}
            <div style={{ position: "absolute", inset: 0, width: `${pct}%`,
              background: on ? "#EEE9FD" : T.bg, transition: "width 240ms ease" }} />
            <span style={{ position: "relative", flex: 1, fontSize: 12.5, fontWeight: on ? 600 : 450, color: T.ink }}>
              {o.label}
            </span>
            {on && <Check size={12} style={{ position: "relative", color: "#7C5CDB" }} />}
            <span className="pd-num" style={{ position: "relative", fontSize: 11.5, fontWeight: 600, color: T.ink3 }}>
              {pct}%
            </span>
          </button>
        );
      })}
      <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>
        {total} vote{total !== 1 ? "s" : ""}{myVote ? " · tap another option to change yours" : ""}
      </div>
    </div>
  );
};

/* --------------------------- TASK REQUEST PANEL ----------------------------
 * The paper trail is shown inline rather than hidden in a report, because the
 * person deciding whether to accept benefits most from seeing that two people
 * have already passed it along. */
const TaskRequestPanel = ({ request, board, members, myMemberId, readOnly, showTrail, onToggleTrail,
  onAccept, onDecline, onOpenProject }) => {
  const events = board.requestEvents.filter((e) => e.requestId === request.id);
  const assignee = members.find((m) => m.id === request.assigneeMemberId);
  const forMe = request.assigneeMemberId === myMemberId && request.status === "pending";
  const statusMeta = {
    pending:     { label: "Awaiting a decision", bg: "#FDF3E3", color: "#B45309" },
    accepted:    { label: "Accepted", bg: "#F2FADF", color: "#3F6212" },
    declined:    { label: "Declined — unassigned", bg: "#FDECEA", color: "#B91C1C" },
    transferred: { label: "Transferred", bg: "#EAF6FE", color: "#0284C7" },
    cancelled:   { label: "Cancelled", bg: T.cardSoft, color: T.ink2 },
  }[request.status] ?? { label: request.status, bg: T.cardSoft, color: T.ink2 };

  return (
    <div style={{ margin: "0 18px 15px", padding: 15, borderRadius: 13,
      border: `1px solid ${forMe ? "#F3D19E" : T.line}`, background: forMe ? "#FFFCF6" : T.cardSoft }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 9 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, flex: 1, minWidth: 140 }}>{request.title}</span>
        <Chip bg={statusMeta.bg} color={statusMeta.color}>{statusMeta.label}</Chip>
      </div>
      <div className="pd-num" style={{ fontSize: 11.5, color: T.ink3, marginBottom: forMe ? 13 : 9 }}>
        For {assignee?.name ?? "nobody yet"}
        {request.deadline ? ` · due ${request.deadline}` : ""} · weight {request.weight}
      </div>

      {forMe && !readOnly && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 11 }}>
          <Btn small onClick={() => onAccept(request)}><Check size={13} /> Accept — make it a task</Btn>
          <Btn small ghost onClick={() => onDecline(request)}>
            <ArrowRightLeft size={13} /> Not mine — pass it on
          </Btn>
        </div>
      )}

      {request.status === "accepted" && request.projectId && (
        <Btn small ghost onClick={() => onOpenProject(request.projectId)}>
          <ChevronRight size={13} /> Open the project
        </Btn>
      )}

      {/* the permanent record */}
      <button onClick={onToggleTrail} className="pd-press" style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, padding: 0,
        background: "none", border: "none", cursor: "pointer",
        fontSize: 11.5, fontWeight: 600, color: T.ink3,
      }}>
        <History size={12} /> {showTrail ? "Hide" : "Show"} paper trail ({events.length})
      </button>
      {showTrail && (
        <div style={{ marginTop: 11, display: "grid", gap: 8, paddingTop: 11, borderTop: `1px solid ${T.lineSoft}` }}>
          {events.map((e) => {
            const from = members.find((m) => m.id === e.fromMemberId);
            const to = members.find((m) => m.id === e.toMemberId);
            const line = {
              requested: `Requested${to ? ` from ${to.name}` : ""}`,
              accepted: `Accepted${to ? ` by ${to.name}` : ""}`,
              declined: `Declined${from ? ` by ${from.name}` : ""}`,
              transferred: `Passed${from ? ` from ${from.name}` : ""}${to ? ` to ${to.name}` : ""}`,
              cancelled: "Cancelled",
            }[e.action] ?? e.action;
            return (
              <div key={e.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, marginTop: 6, flexShrink: 0,
                  background: e.action === "declined" ? "#B91C1C" : e.action === "accepted" ? T.limeDeep : T.ink3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.ink }}>{line}</div>
                  {e.reason && <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 1, lineHeight: 1.5 }}>“{e.reason}”</div>}
                  <div className="pd-num" style={{ fontSize: 10.5, color: T.ink3, marginTop: 2 }}>
                    {new Date(e.at).toLocaleString("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ------------------------------ POST COMPOSER ------------------------------
 * The kind is picked first and everything below adapts to it, because the
 * fields a poll needs and the fields a task request needs have nothing in
 * common — showing all of them at once and greying most out would be worse. */
const PostComposer = ({ members, projects, tasks, companies, defaultCompanyId, onSave, onClose }) => {
  const [kind, setKind] = useState("update");
  const [caption, setCaption] = useState("");
  const [projectId, setProjectId] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId && defaultCompanyId !== "all" ? defaultCompanyId : "");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [req, setReq] = useState({ title: "", assigneeMemberId: "", deadline: "", weight: 1 });
  const [taskId, setTaskId] = useState("");

  const onPick = (e) => {
    /* 50 MB is the bucket's per-object limit (schema_v5.sql), so reject
     * oversize files here rather than after a long upload that then fails. */
    const picked = [...e.target.files].filter((f) => {
      if (f.size > 50 * 1024 * 1024) { alert(`"${f.name}" is over the 50 MB limit and was skipped.`); return false; }
      return true;
    });
    setFiles((cur) => [...cur, ...picked].slice(0, 6));
    e.target.value = "";
  };

  const validPoll = pollOptions.filter((o) => o.trim()).length >= 2;
  const ready = !busy && (
    kind === "poll" ? validPoll && caption.trim()
    : kind === "task_request" ? req.title.trim() && req.assigneeMemberId
    : caption.trim() || files.length
  );

  const submit = async () => {
    setBusy(true);
    await onSave({
      kind, caption: caption.trim(), projectId, companyId, taskId: kind === "accomplished" ? taskId : "",
      pollOptions, requestTitle: req.title.trim(), assigneeMemberId: req.assigneeMemberId,
      requestDeadline: req.deadline, requestWeight: req.weight,
    }, files);
    setBusy(false);
  };

  return (
    <Modal title="New post" wide onClose={onClose}
      subtitle="Pick what you want back from people — that's what changes how the post behaves.">
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>What is this?</Label>
          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(POST_KIND_META).map(([key, meta]) => {
              const on = kind === key;
              const Icon = meta.icon;
              return (
                <button key={key} type="button" onClick={() => setKind(key)} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 11,
                  cursor: "pointer", textAlign: "left",
                  background: on ? meta.bg : T.card, border: `1px solid ${on ? meta.color + "44" : T.line}`,
                }}>
                  <Icon size={15} style={{ color: on ? meta.color : T.ink3, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? meta.color : T.ink }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>{meta.blurb}</div>
                  </div>
                  {on && <Check size={13} style={{ color: meta.color, flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>{kind === "poll" ? "Question" : "Caption"}</Label>
          <textarea rows={3} style={{ ...inputStyle, minHeight: 78, paddingTop: 11, resize: "vertical" }}
            value={caption} onChange={(e) => setCaption(e.target.value)}
            placeholder={kind === "poll" ? "e.g. Which finish for the lobby wall?"
              : kind === "discussion" ? "e.g. Ceiling detail came out like this — thoughts before we repeat it?"
              : kind === "task_request" ? "Any context for the person you're asking…"
              : "Say something about this…"} />
        </div>

        {kind === "poll" && (
          <div>
            <Label>Options</Label>
            <div style={{ display: "grid", gap: 7 }}>
              {pollOptions.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <input style={inputStyle} value={o} placeholder={`Option ${i + 1}`}
                    onChange={(e) => setPollOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))} />
                  {pollOptions.length > 2 && (
                    <IconBtn label="Remove option" danger
                      onClick={() => setPollOptions((os) => os.filter((_, j) => j !== i))}>
                      <X size={13} />
                    </IconBtn>
                  )}
                </div>
              ))}
            </div>
            {pollOptions.length < 6 && (
              <Btn small ghost onClick={() => setPollOptions((os) => [...os, ""])} >
                <Plus size={12} /> Add option
              </Btn>
            )}
          </div>
        )}

        {kind === "task_request" && (
          <>
            <div><Label>What needs doing?</Label>
              <input style={inputStyle} value={req.title} onChange={(e) => setReq({ ...req, title: e.target.value })}
                placeholder="e.g. Re-do the skirting on the north wall" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              <div><Label>Ask who?</Label>
                <select style={inputStyle} value={req.assigneeMemberId}
                  onChange={(e) => setReq({ ...req, assigneeMemberId: e.target.value })}>
                  <option value="">Select someone…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></div>
              <div><Label>Deadline</Label>
                <input type="date" style={inputStyle} value={req.deadline}
                  onChange={(e) => setReq({ ...req, deadline: e.target.value })} /></div>
              <div><Label>Weight</Label>
                <input type="number" min={1} max={10} style={inputStyle} value={req.weight}
                  onChange={(e) => setReq({ ...req, weight: Math.max(1, Math.min(10, +e.target.value || 1)) })} /></div>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: T.ink3, lineHeight: 1.55 }}>
              Weight sets how much this task will fill the project's progress bar once done (1 = light,
              10 = major milestone) — see the note on Weight when adding a task directly for how that math works.
              Once sent, they can accept it — which turns it into a real task — or pass it to someone else with a
              reason. Either way it's written to a permanent trail that shows up in reports.
            </p>
          </>
        )}

        {kind === "accomplished" && (
          <div><Label>Which task? (optional)</Label>
            <select style={inputStyle} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Not linked to a task</option>
              {tasks.filter((t) => t.state !== "completed").map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select></div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Post to</Label>
            <select style={inputStyle} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Whole workspace</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select></div>
          <div><Label>Project (optional)</Label>
            <select style={inputStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        </div>

        <div>
          <Label>Photos & video</Label>
          <label className="pd-press" style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 46,
            borderRadius: 11, cursor: "pointer", border: `1px dashed ${T.line}`, background: T.cardSoft,
            fontSize: 12.5, color: T.ink2, fontWeight: 500,
          }}>
            <Paperclip size={14} /> Choose files — up to 6, 50 MB each
            <input type="file" multiple accept="image/*,video/*" onChange={onPick} style={{ display: "none" }} />
          </label>
          {files.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 9 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px",
                  borderRadius: 9, border: `1px solid ${T.line}`, fontSize: 12 }}>
                  <ImageIcon size={13} style={{ color: T.ink3, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", color: T.ink2 }}>{f.name}</span>
                  <span className="pd-num" style={{ fontSize: 11, color: T.ink3 }}>{(f.size / 1048576).toFixed(1)} MB</span>
                  <IconBtn label="Remove file" danger onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </IconBtn>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!ready} onClick={submit}>
            <Send size={14} /> {busy ? "Posting…" : "Post"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

/* --------------------------- DECLINE / TRANSFER ---------------------------- */
const DeclineRequestModal = ({ req, members, onConfirm, onClose }) => {
  const [toMemberId, setToMemberId] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Modal title="Pass this on" subtitle={req.title} onClose={onClose} tone="danger">
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Who should do it instead?</Label>
          <select style={inputStyle} value={toMemberId} onChange={(e) => setToMemberId(e.target.value)}>
            <option value="">Nobody — just decline it</option>
            {members.filter((m) => m.id !== req.assigneeMemberId)
              .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Why? (required)</Label>
          <textarea rows={3} style={{ ...inputStyle, minHeight: 78, paddingTop: 11, resize: "vertical" }}
            value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. This is site electrical — Priya handles that scope" />
          <p style={{ margin: "7px 0 0", fontSize: 11, color: T.ink3, lineHeight: 1.55 }}>
            This is written to the permanent record and cannot be edited or deleted afterwards.
            It appears in the task's paper trail and in any report that includes it.
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!reason.trim()} onClick={() => onConfirm({ toMemberId: toMemberId || null, reason: reason.trim() })}>
            {toMemberId ? <><ArrowRightLeft size={14} /> Transfer</> : <><Ban size={14} /> Decline</>}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ============================================================================
 * PEOPLE & ACCESS — who can actually sign in and see this workspace
 *
 * The distinction that trips people up: TeamView's roster (team_members) is
 * "names I can assign work to", and can include people with no account at
 * all. This screen is "accounts that can open this workspace". Inviting
 * someone optionally links the two, so a roster entry becomes a real person.
 * ==========================================================================*/
const PeopleView = ({ memberships, members, workspace, myRole, myEmail, onInvite, onChangeRole, onRemove, onRename }) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [memberId, setMemberId] = useState("");
  const [name, setName] = useState(workspace?.name ?? "");
  const admin = canAdmin(myRole);
  const personal = workspace?.kind === "personal";
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  /* Roster entries nobody has been invited as yet — the useful ones to offer,
   * since re-linking an already-invited entry would just fail the unique index. */
  const linkedIds = new Set(memberships.map((m) => m.memberId).filter(Boolean));
  const unlinked = members.filter((m) => !linkedIds.has(m.id));

  const submit = () => {
    onInvite({ email: email.trim(), role, memberId: memberId || null });
    setEmail(""); setMemberId(""); setRole("member");
  };

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Workspace access" title="People & access"
        sub="Invite teammates by email. They sign up (or sign in) and this workspace appears for them — their existing personal workspace stays untouched." />

      {personal && (
        <Card soft style={{ padding: "14px 18px", marginBottom: 18, display: "flex", gap: 11, alignItems: "flex-start" }}>
          <Lock size={15} style={{ color: T.ink3, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6 }}>
            This is your <strong>personal</strong> workspace — it is private to you and cannot be shared.
            Create a team workspace from the switcher in the sidebar to start collaborating.
          </div>
        </Card>
      )}

      {!personal && admin && (
        <Card style={{ padding: 22, marginBottom: 20 }}>
          <SectionHead title="Invite someone" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div><Label>Email address</Label>
              <input style={inputStyle} value={email} type="email" placeholder="teammate@company.com"
                onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Role</Label>
              <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.entries(ROLE_META)
                  /* You can only grant a role below your own — otherwise an
                   * admin could mint a second owner and lock the first out. */
                  .filter(([key]) => ROLE_META[key].rank < ROLE_META[myRole].rank)
                  .map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
              </select></div>
            <div><Label>Link to roster entry (optional)</Label>
              <select style={inputStyle} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Don't link</option>
                {unlinked.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.55, maxWidth: 460 }}>
              {ROLE_META[role].hint}. Linking to a roster entry means tasks already assigned to that
              name become theirs.
            </span>
            <Btn disabled={!emailValid} onClick={submit}><Send size={14} /> Send invite</Btn>
          </div>
        </Card>
      )}

      <SectionHead title={`${memberships.length} ${memberships.length === 1 ? "person" : "people"}`} />
      <div style={{ display: "grid", gap: 8 }}>
        {memberships.map((m) => {
          const linked = members.find((x) => x.id === m.memberId);
          const isMe = (m.email || "").toLowerCase() === (myEmail || "").toLowerCase();
          /* Nobody may act on a peer or a superior — that is what keeps an
           * admin from demoting the owner or removing another admin. */
          const manageable = admin && !isMe && ROLE_META[m.role].rank < ROLE_META[myRole].rank;
          return (
            <Card key={m.id} style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
              <div style={{ width: 32, height: 32, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center",
                background: T.bg, border: `1px solid ${T.line}`, fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                {(linked?.name ?? m.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                  {linked?.name ?? m.email}{isMe && <span style={{ color: T.ink3, fontWeight: 450 }}> · you</span>}
                </div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                  {linked ? m.email : ROLE_META[m.role].hint}
                </div>
              </div>
              {m.status === "invited" && <Chip bg="#FDF3E3" color="#B45309">Invite pending</Chip>}
              {manageable ? (
                <select value={m.role} onChange={(e) => onChangeRole(m, e.target.value)}
                  style={{ ...inputStyle, width: "auto", minWidth: 108, height: 34, fontSize: 12, padding: "0 10px" }}>
                  {Object.entries(ROLE_META)
                    .filter(([key]) => ROLE_META[key].rank < ROLE_META[myRole].rank)
                    .map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                </select>
              ) : (
                <Chip bg={m.role === "viewer" ? T.cardSoft : "#F2FADF"} color={m.role === "viewer" ? T.ink2 : "#3F6212"}>
                  {m.role === "viewer" ? <Eye size={10} /> : <ShieldCheck size={10} />} {ROLE_META[m.role].label}
                </Chip>
              )}
              {manageable && <IconBtn label={`Remove ${m.email}`} danger onClick={() => onRemove(m)}><Trash2 size={13} /></IconBtn>}
            </Card>
          );
        })}
        {memberships.length === 0 && <Empty text="Nobody here yet." />}
      </div>

      {!personal && admin && (
        <>
          <SectionHead title="Workspace settings" />
          <Card style={{ padding: 22, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Label>Workspace name</Label>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Btn ghost disabled={!name.trim() || name === workspace?.name} onClick={() => onRename(name.trim())}>
              <Check size={14} /> Rename
            </Btn>
          </Card>
        </>
      )}
    </div>
  );
};

/* --------------------------- NEW WORKSPACE FORM ----------------------------- */
const WorkspaceForm = ({ onSave, onClose }) => {
  const [name, setName] = useState("");
  return (
    <Modal title="New workspace" onClose={onClose}
      subtitle="A shared space with its own companies, projects, team and calendar. Nothing is copied across from your other workspaces.">
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Workspace name</Label>
          <input style={inputStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jhydro Interiors — Site Team" /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!name.trim()} onClick={() => onSave(name.trim())}><Check size={15} /> Create</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* --------------------------- ACCENT PICKER (item 4) ------------------------
 * A personal, device-local preference — nobody else's view changes when you
 * pick one, only yours, and only for whichever workspace you picked it for
 * (see chooseAccent/applyAccent). Same ColorPicker CompanyForm uses above. */
const AccentPickerModal = ({ value, onSave, onClose }) => {
  const [theme, setTheme] = useState(value);
  return (
    <Modal title="Workspace color" onClose={onClose}
      subtitle="Pick a color just for this workspace — helps tell them apart at a glance when you're juggling more than one. Only you see this.">
      <div style={{ display: "grid", gap: 18 }}>
        <ColorPicker value={theme} onChange={setTheme} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(theme)}><Check size={15} /> Apply</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ============================================================================
 * CALENDAR WORKSPACE — clock-in/out, holiday & travel logging, alert controls
 * ==========================================================================*/
const ClockTicker = ({ since }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return <span className="pd-num">{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
};

/* Per-task duration (item 2) — same live-ticking idea as ClockTicker, but
 * counting a task's OWN accumulated active_minutes + whatever's run since
 * its current started_at, entirely independent of any other task. Turns
 * amber past its estimate rather than stopping — an overrun keeps counting
 * up instead of resetting, and never touches any other task's numbers. */
const TaskDurationBadge = ({ task }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!task.startedAt) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [task.startedAt]);
  const runningMinutes = task.startedAt ? (now - new Date(task.startedAt).getTime()) / 60000 : 0;
  const totalMinutes = (task.activeMinutes ?? 0) + runningMinutes;
  const overrun = task.estimatedMinutes && totalMinutes > task.estimatedMinutes;
  const m = Math.floor(totalMinutes);
  const s = Math.floor((totalMinutes - m) * 60);
  return (
    <Chip bg={overrun ? "#FDF3E3" : T.cardSoft} color={overrun ? "#B45309" : T.ink2}>
      <Play size={9} /> <span className="pd-num">{m}:{String(s).padStart(2, "0")}</span>
      {task.estimatedMinutes ? ` / ${task.estimatedMinutes}m` : ""}
    </Chip>
  );
};

const EVENT_TYPE_META = {
  meeting: { label: "Meeting", icon: Video, color: "#0284C7", bg: "#EAF6FE" },
  visit: { label: "Visit", icon: MapPin, color: "#B45309", bg: "#FDF3E3" },
  other: { label: "Other", icon: CalendarClock, color: T.ink2, bg: T.cardSoft },
};

/* ------------------------- GOOGLE CALENDAR CONNECTION -----------------------
 * Connect is a full-page redirect to Google (no way around that — a consent
 * screen can't render in an iframe or a fetch response), so this card is
 * mostly status + a couple of buttons, not a form. */
const GoogleCalendarCard = ({ connection, syncing, onConnect, onDisconnect, onSyncNow, onToggleAutoSync, onRequestAccess }) => (
  <Card style={{ padding: "16px 20px", marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
        background: connection ? "#F2FADF" : T.cardSoft, color: connection ? "#3F6212" : T.ink3 }}>
        <CalendarDays size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
          {connection ? "Google Calendar connected" : "Google Calendar not connected"}
        </div>
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
          {connection
            ? `${connection.googleEmail ?? "Connected"}${connection.lastSyncedAt ? ` · last synced ${relativeTime(connection.lastSyncedAt)}` : " · not yet synced"}`
            : "Two-way sync — events created here appear in Google, and vice versa."}
        </div>
      </div>
      {connection ? (
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small ghost disabled={syncing} onClick={onSyncNow}>
            {syncing ? "Syncing…" : <><RotateCcw size={13} /> Sync now</>}
          </Btn>
          <Btn small danger onClick={onDisconnect}>Disconnect</Btn>
        </div>
      ) : (
        <Btn small onClick={onConnect}><CalendarPlus size={14} /> Connect Google Calendar</Btn>
      )}
    </div>
    {/* Found already wired up server-side (request_google_calendar_access,
      * schema_v8/v11) with no client ever calling it — Google's OAuth
      * consent screen only lets pre-registered "test users" through, so
      * this is the escape hatch for someone who hits that wall with no
      * way to fix it themselves. Shown regardless of role rather than
      * threading myRole down here just for this: an admin clicking it
      * simply notifies zero people (the RPC excludes the caller), which
      * is a harmless no-op, not a confusing dead end. */}
    {!connection && (
      <button type="button" onClick={onRequestAccess} className="pd-press" style={{
        display: "block", marginTop: 10, background: "none", border: "none", padding: 0,
        cursor: "pointer", fontSize: 11.5, color: T.limeDeep, fontWeight: 600, textAlign: "left",
      }}>
        Can't connect? Ask an admin for access
      </button>
    )}
    {/* item 5 — background auto-sync is additive to the two mechanisms
      * that already exist: the manual "Sync now" above, and the while-the-
      * tab-is-open 3-minute poll. This toggle is the only one that keeps
      * working with nobody looking at the app at all (pg_cron, every 15
      * minutes — see schema_v11.sql). */}
    {connection && (
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14,
        borderTop: `1px solid ${T.lineSoft}`, cursor: "pointer" }}>
        <input type="checkbox" checked={connection.autoSync} onChange={(e) => onToggleAutoSync(e.target.checked)} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>Auto-sync in the background</div>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>
            Keeps syncing every 15 minutes even when nobody has Puroductive open. Manual "Sync now" still works either way.
          </div>
        </div>
      </label>
    )}
  </Card>
);

/* ------------------------- CLOCK AUTOMATION (item 1) ------------------------
 * Personal webhook tokens for phone-side clock-in/out — Apple Shortcuts can
 * call these natively on arrive/leave; Samsung's own Routines app can react
 * to location but can't call a URL, so Android needs one bridge app
 * (Tasker, Automate, or IFTTT) doing the same Location trigger → HTTP call. */
const ClockAutomationCard = ({ tokens, freshToken, onGenerate, onRevoke, onDismissFresh }) => {
  const [label, setLabel] = useState("");
  const functionsBase = "https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/clock-webhook";
  const urlFor = (token, action) => `${functionsBase}?token=${token}&action=${action}`;
  return (
    <Card style={{ padding: "16px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
          background: T.cardSoft, color: T.ink3 }}>
          <Smartphone size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Clock-in automation</div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
            Auto clock in/out on arrival — native via Apple Shortcuts, or Tasker/Automate/IFTTT on Android.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inputStyle, width: 150 }} placeholder="Label, e.g. My phone"
            value={label} onChange={(e) => setLabel(e.target.value)} />
          <Btn small onClick={() => { onGenerate(label); setLabel(""); }}><KeyRound size={13} /> Generate token</Btn>
        </div>
      </div>

      {freshToken && (
        <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, background: "#FFFCF6", border: "1px solid #F3D19E" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#78350F", marginBottom: 10 }}>
            Copy these now — for security, the token isn't shown again after you leave this screen.
          </div>
          {[["Clock in", "in"], ["Clock out", "out"]].map(([actionLabel, action]) => (
            <div key={action} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Chip>{actionLabel}</Chip>
              <code className="pd-num" style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: T.ink2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {urlFor(freshToken.token, action)}
              </code>
              <IconBtn label={`Copy ${actionLabel} URL`}
                onClick={() => navigator.clipboard?.writeText(urlFor(freshToken.token, action))}>
                <Copy size={13} />
              </IconBtn>
            </div>
          ))}
          <div style={{ fontSize: 11, color: T.ink3, lineHeight: 1.7, marginTop: 8 }}>
            <strong>Apple Shortcuts:</strong> Automations → Arrive/Leave at a location → Get Contents of URL (paste the Clock In / Clock Out URL). Fully native.<br />
            <strong>Android:</strong> Samsung's Modes/Routines app can trigger on location but can't call a URL directly — use Tasker, Automate, or IFTTT instead (Location trigger + an HTTP/Webhooks action hitting the same URL).
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn small ghost onClick={onDismissFresh}>Done — I've saved these</Btn>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          {tokens.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.line}` }}>
              <KeyRound size={13} style={{ color: T.ink3, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.ink2 }}>
                {t.label} · {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : "never used yet"}
              </div>
              <IconBtn label="Revoke" danger onClick={() => onRevoke(t.id)}><Trash2 size={12} /></IconBtn>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

const CalendarView = ({ exceptions, sessions, activeSession, clockIn, clockOut, tasks, alertsOn, enableAlerts,
  events, projects, companies, members, groups, googleConnection, googleSyncing,
  onConnectGoogle, onDisconnectGoogle, onSyncGoogleNow, onToggleGoogleAutoSync, onRequestGoogleAccess,
  automationTokens, freshAutomationToken, onGenerateAutomationToken, onRevokeAutomationToken, onDismissFreshToken,
  onAddEvent, onEditEvent, onDeleteEvent, onMarkDay, onOpenDay, onOpenProject }) => {
  const isMobile = useIsMobile();
  const stats = computeMonthlyStats({ sessions, tasks, exceptions }, 0);
  const { start, end, label } = monthWindow(0);
  const today = ymdOf(new Date());
  const days = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const lead = start.getDay(); // blank cells before day 1 (week starts Sunday)
  const monthSessions = sessions.filter((s) => new Date(s.loginAt) >= start && new Date(s.loginAt) < end);
  const exFor = (ymd) => exceptions.find((x) => x.date === ymd);
  const todaysTasks = tasksDueOn(tasks, today);
  const markedTasks = tasks.filter((t) => t.isMarked && t.state !== "completed");
  const agenda = buildAgenda({ events, tasks, projects }, 14);

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Time & interruption" title="Calendar"
        sub="Tap a day to see its schedule — meetings, visits, task deadlines, and mark holiday/travel."
        action={<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn ghost onClick={enableAlerts}><Bell size={14} /> {alertsOn ? "Alerts on · test chime" : "Enable native alerts"}</Btn>
          <Btn ghost onClick={() => onMarkDay(today)}><Palmtree size={14} /> Mark a day</Btn>
          <Btn onClick={() => onAddEvent(today)}><CalendarPlus size={14} /> Add event</Btn>
        </div>} />

      <GoogleCalendarCard connection={googleConnection} syncing={googleSyncing}
        onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} onSyncNow={onSyncGoogleNow}
        onToggleAutoSync={onToggleGoogleAutoSync} onRequestAccess={onRequestGoogleAccess} />

      <ClockAutomationCard tokens={automationTokens} freshToken={freshAutomationToken}
        onGenerate={onGenerateAutomationToken} onRevoke={onRevokeAutomationToken} onDismissFresh={onDismissFreshToken} />

      {/* Clock + month stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
        <Card style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>
            {activeSession ? "Clocked in — session running" : "Off the clock"}
          </div>
          <div style={{ fontFamily: T.fontDisplay, fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: activeSession ? T.ink : T.ink3 }}>
            {activeSession ? <ClockTicker since={activeSession.loginAt} /> : "00:00:00"}
          </div>
          {activeSession
            ? <Btn ink onClick={clockOut}><LogOut size={14} /> Clock out</Btn>
            : <Btn onClick={clockIn}><LogIn size={14} /> Clock in</Btn>}
        </Card>
        <Card style={{ padding: "20px 22px" }}>
          <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em" }}>{stats.hours.toFixed(1)}h</div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Absolute hours · {label}</div>
          <div style={{ marginTop: 6, fontSize: 11.5, color: T.ink3 }}>{monthSessions.length} logged session{monthSessions.length !== 1 ? "s" : ""}</div>
        </Card>
        <Card style={{ padding: "20px 22px" }}>
          <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em",
            color: stats.lossFactor > 0.15 ? "#B45309" : T.ink }}>{Math.round(stats.lossFactor * 100)}%</div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Productivity loss factor</div>
          <div className="pd-num" style={{ marginTop: 6, fontSize: 11.5, color: T.ink3 }}>{stats.lossDays} of {stats.workingDays} working days interrupted</div>
        </Card>
        <Card style={{ padding: "20px 22px" }}>
          <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em",
            color: stats.leaveDays > 0 ? "#7C5CDB" : T.ink }}>{stats.leaveDays}</div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Leave days · {label}</div>
          <div className="pd-num" style={{ marginTop: 6, fontSize: 11.5, color: T.ink3 }}>
            {stats.interruptionDays} holiday/travel · {stats.leaveByReason.length} reason{stats.leaveByReason.length !== 1 ? "s" : ""}
          </div>
        </Card>
      </div>

      {/* ------------------------- TODAY, front and centre -------------------
        * Item 3's "tasks that have to be done today must be highlighted": a
        * dedicated panel above the grid rather than a stat tile, because a
        * count is not actionable and a list is. */}
      <Card soft style={{ padding: isMobile ? 16 : "20px 24px", marginBottom: 20,
        border: `1.5px solid ${T.limeDeep}`, boxShadow: "0 0 0 4px rgba(124,181,24,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: todaysTasks.length ? 14 : 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <CalendarClock size={16} style={{ color: T.limeDeep }} />
            <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Due today
            </h2>
            <span className="pd-num" style={{ fontSize: 11.5, color: T.ink3 }}>{today}</span>
          </div>
          {markedTasks.length > 0 && (
            <Chip bg="#FDF3E3" color="#B45309"><Star size={10} /> {markedTasks.length} marked</Chip>
          )}
        </div>
        {todaysTasks.length === 0
          ? <div style={{ fontSize: 12.5, color: T.ink3 }}>Nothing due today — the day is yours.</div>
          : <div style={{ display: "grid", gap: 8 }}>
              {todaysTasks.map((t) => {
                const p = projects.find((x) => x.id === t.projectId);
                const who = taskAudience(t, members, groups);
                const meta = STATE_META[t.state];
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap",
                    padding: "10px 13px", borderRadius: 10, background: T.card, border: `1px solid ${t.isMarked ? "#F3D19E" : T.line}` }}>
                    {t.isMarked && <Star size={12} style={{ color: "#D97706", fill: "#D97706", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                        {p?.name ?? "—"} · {who}{t.markLabel ? ` · ${t.markLabel}` : ""}
                      </div>
                    </div>
                    <Chip bg={t.scope === "team" ? "#EAF6FE" : T.cardSoft} color={t.scope === "team" ? "#0284C7" : T.ink2}>
                      {t.scope === "team" ? <Users size={10} /> : <UserCheck size={10} />} {t.scope === "team" ? "Team" : "Individual"}
                    </Chip>
                    <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
                  </div>
                );
              })}
            </div>}
      </Card>

      {/* Month grid */}
      <Card style={{ padding: isMobile ? 12 : 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{label}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip bg={EXCEPTION_META.holiday.bg} color={EXCEPTION_META.holiday.color}><Sun size={10} /> Holiday</Chip>
            <Chip bg={EXCEPTION_META.travel.bg} color={EXCEPTION_META.travel.color}><Plane size={10} /> Travel</Chip>
            <Chip bg={EXCEPTION_META.leave_declared.bg} color={EXCEPTION_META.leave_declared.color}><Palmtree size={10} /> Leave booked</Chip>
            <Chip bg={EXCEPTION_META.leave_taken.bg} color={EXCEPTION_META.leave_taken.color}><Palmtree size={10} /> Leave taken</Chip>
            <Chip bg={EVENT_TYPE_META.meeting.bg} color={EVENT_TYPE_META.meeting.color}><Video size={10} /> Meeting/Visit</Chip>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: isMobile ? 3 : 6 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: isMobile ? 9 : 10.5, fontWeight: 600, letterSpacing: "0.05em",
              textTransform: "uppercase", color: T.ink3, padding: "4px 0" }}>{isMobile ? d.slice(0, 1) : d}</div>
          ))}
          {Array.from({ length: lead }).map((_, i) => <div key={"b" + i} />)}
          {days.map((d) => {
            const ymd = ymdOf(d);
            const ex = exFor(ymd);
            const isToday = ymd === today;
            const sunday = d.getDay() === 0;
            const worked = monthSessions.some((s) => ymdOf(new Date(s.loginAt)) === ymd);
            const dayEvents = events.filter((e) => e.date === ymd);
            const dayTasks = tasksDueOn(tasks, ymd);
            const dayDeadlines = projectDeadlinesOn(projects, ymd);
            const marked = dayTasks.filter((t) => t.isMarked);
            const exMeta = ex ? EXCEPTION_META[ex.type] ?? EXCEPTION_META.holiday : null;
            const ExIcon = ex ? (isLeaveType(ex.type) ? Palmtree : ex.type === "holiday" ? Sun : Plane) : null;
            return (
              <button key={ymd} onClick={() => onOpenDay(ymd)} className="pd-press"
                title={ex ? `${exMeta.label}${ex.reason ? " · " + ex.reason : ""}` : "Tap to view schedule"}
                style={{
                  position: "relative", overflow: "hidden", minHeight: isMobile ? 44 : 66, borderRadius: isMobile ? 8 : 12,
                  cursor: "pointer", textAlign: "left", padding: isMobile ? "5px 4px" : "8px 9px",
                  /* Today gets a heavier ring than a marked day so "what do I
                   * do now" always wins the eye over "what did I flag". */
                  border: `${isToday ? 2 : 1}px solid ${isToday ? T.limeDeep : marked.length ? "#D97706" : T.line}`,
                  boxShadow: isToday ? "0 0 0 4px rgba(124,181,24,0.22)"
                    : marked.length ? "0 0 0 2px rgba(217,119,6,0.16)" : "none",
                  opacity: sunday && !ex && !dayEvents.length && !dayTasks.length && !dayDeadlines.length ? 0.45 : 1,
                  background: T.card,
                  ...(ex ? meshBackground(exMeta.mesh) : isToday ? meshBackground(["#F6FEE7", "#EFFCC9", "#E4F9AC"]) : {}),
                }}>
                {(ex || isToday) && <GrainOverlay opacity={0.2} radius={12} />}
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
                  <span className="pd-num" style={{ fontSize: 12.5, fontWeight: isToday ? 700 : 600,
                    color: ex ? exMeta.color : isToday ? "#3F6212" : T.ink }}>
                    {d.getDate()}
                  </span>
                  {ex && <ExIcon size={12} style={{ color: exMeta.color }} />}
                  {!ex && worked && <span style={{ width: 5, height: 5, borderRadius: 99, background: T.limeDeep }} title="Session logged" />}
                  <div style={{ display: "flex", gap: 3, marginTop: "auto", flexWrap: "wrap", alignItems: "center" }}>
                    {marked.length > 0 && <Star size={9} style={{ color: "#D97706", fill: "#D97706" }} />}
                    {dayEvents.length > 0 && <span style={{ width: 5, height: 5, borderRadius: 99, background: "#0284C7" }} title={`${dayEvents.length} event(s)`} />}
                    {dayTasks.length > 0 && <span style={{ width: 5, height: 5, borderRadius: 99, background: "#D97706" }} title={`${dayTasks.length} task(s) due`} />}
                    {dayDeadlines.length > 0 && <span style={{ width: 5, height: 5, borderRadius: 99, background: "#B91C1C" }} title={`${dayDeadlines.length} project deadline(s)`} />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p style={{ margin: "16px 0 0", fontSize: 11.5, color: T.ink3, lineHeight: 1.6 }}>
          Native alarm hooks: this build rings a WebAudio chime + browser notification; on Android the same
          <span className="pd-num"> AlarmService</span> interface is backed by Capacitor LocalNotifications with the device sound library.
        </p>
      </Card>

      {/* Upcoming agenda */}
      <SectionHead title="Upcoming — next 14 days" />
      <div style={{ display: "grid", gap: 8 }}>
        {agenda.map((item) => {
          if (item.kind === "event") {
            const meta = EVENT_TYPE_META[item.ref.type] ?? EVENT_TYPE_META.other;
            const Icon = meta.icon;
            const c = companies.find((x) => x.id === item.ref.companyId);
            return (
              <Card key={"e" + item.id} style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                <Chip bg={meta.bg} color={meta.color}><Icon size={11} /> {meta.label}</Chip>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.ref.title}</div>
                  <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                    {item.ref.date}{item.ref.startTime ? ` · ${item.ref.startTime}` : ""}{c ? ` · ${c.name}` : ""}{item.ref.location ? ` · ${item.ref.location}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: T.ink3, flexShrink: 0 }}>{relativeDayLabel(item.date)}</span>
              </Card>
            );
          }
          if (item.kind === "task") {
            const p = projects.find((x) => x.id === item.ref.projectId);
            return (
              <Card key={"t" + item.id} style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                <Chip bg="#FDF3E3" color="#B45309">Task due</Chip>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.ref.title}</div>
                  <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{item.date}{p ? ` · ${p.name}` : ""}</div>
                </div>
                <span style={{ fontSize: 11, color: T.ink3, flexShrink: 0 }}>{relativeDayLabel(item.date)}</span>
              </Card>
            );
          }
          const c = companies.find((x) => x.id === item.ref.companyId);
          return (
            <Card key={"p" + item.id} className="pd-rise" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
              onClick={() => onOpenProject(item.ref.id)}>
              <Chip bg="#FDECEA" color="#B91C1C"><Briefcase size={11} /> Project deadline</Chip>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.ref.name}</div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{item.date}{c ? ` · ${c.name}` : ""}</div>
              </div>
              <span style={{ fontSize: 11, color: T.ink3, flexShrink: 0 }}>{relativeDayLabel(item.date)}</span>
            </Card>
          );
        })}
        {agenda.length === 0 && <Empty text="Nothing scheduled in the next 14 days." />}
      </div>
    </div>
  );
};

/* --------------------------- CALENDAR EVENT FORM ---------------------------- */
const CalendarEventForm = ({ data, defaultDate, companies, projects, members, onSave, onClose }) => {
  const [f, setF] = useState(data ?? {
    title: "", type: "meeting", date: defaultDate || todayIso(),
    startTime: "", endTime: "", companyId: "", projectId: "", location: "", notes: "",
  });
  const [attendeeIds, setAttendeeIds] = useState(data?.attendeeIds ?? []);
  const toggleAttendee = (id) => setAttendeeIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const projectOptions = projects.filter((p) => !f.companyId || p.companyId === f.companyId);
  return (
    <Modal title={data ? "Edit event" : "Add event"} wide onClose={onClose}
      subtitle="Meetings, site visits, or anything else worth putting on the calendar.">
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Title</Label>
          <input style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="e.g. Site visit — Shree Jagdamba floor" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="meeting">Meeting</option>
              <option value="visit">Visit</option>
              <option value="other">Other</option>
            </select></div>
          <div><Label>Date</Label>
            <input type="date" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div><Label>Location</Label>
            <input style={inputStyle} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Start time</Label>
            <input type="time" style={inputStyle} value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></div>
          <div><Label>End time</Label>
            <input type="time" style={inputStyle} value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <div><Label>Company (optional)</Label>
            <select style={inputStyle} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, projectId: "" })}>
              <option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><Label>Project (optional)</Label>
            <select style={inputStyle} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">—</option>
              {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        </div>
        <div>
          <Label>Attendees</Label>
          <div style={{ display: "grid", gap: 6, maxHeight: 160, overflowY: "auto" }} className="pd-scroll">
            {members.map((m) => {
              const on = attendeeIds.includes(m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggleAttendee(m.id)} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 10,
                  cursor: "pointer", textAlign: "left",
                  background: on ? "#F4FBE3" : T.card, border: `1px solid ${on ? "#C9E88A" : T.line}`,
                }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{m.name}</span>
                  {on && <Check size={13} style={{ color: T.limeDeep }} />}
                </button>
              );
            })}
          </div>
        </div>
        <div><Label>Notes</Label>
          <textarea rows={2} style={{ ...inputStyle, minHeight: 60, paddingTop: 11, resize: "vertical" }}
            value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.title.trim() || !f.date} onClick={() => onSave({
            ...f, companyId: f.companyId || null, projectId: f.projectId || null, attendeeIds,
          })}><Check size={15} /> {data ? "Save" : "Add event"}</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------ MARK A DAY ----------------------------------
 * Replaces the old click-to-cycle day toggle. Leave requires a reason before
 * it can be saved — that requirement is the entire reason this is a form and
 * not a toggle, since the month-end report groups leave by reason and a blank
 * one makes the report useless. */
const MarkDayModal = ({ date, existing, members, onSave, onClear, onClose }) => {
  const [f, setF] = useState({
    type: existing?.type ?? "holiday",
    reason: existing?.reason ?? "",
    memberId: existing?.memberId ?? "",
  });
  const needsReason = isLeaveType(f.type);
  const ready = !needsReason || f.reason.trim().length > 0;
  const dow = new Date(date + "T00:00:00").toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });
  return (
    <Modal title="Mark this day" subtitle={dow} onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Day type</Label>
          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(EXCEPTION_META).map(([key, meta]) => {
              const on = f.type === key;
              const Icon = meta.leave ? Palmtree : key === "holiday" ? Sun : Plane;
              return (
                <button key={key} type="button" onClick={() => setF({ ...f, type: key })} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
                  cursor: "pointer", textAlign: "left",
                  background: on ? meta.bg : T.card, border: `1px solid ${on ? meta.color + "44" : T.line}`,
                }}>
                  <Icon size={14} style={{ color: on ? meta.color : T.ink3, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: on ? 600 : 450, color: on ? meta.color : T.ink2 }}>
                    {meta.label}
                  </span>
                  {on && <Check size={13} style={{ color: meta.color }} />}
                </button>
              );
            })}
          </div>
        </div>

        {needsReason && (
          <div>
            <Label>Reason for leave (required)</Label>
            <input style={inputStyle} value={f.reason} autoFocus
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              placeholder="e.g. Medical, Family function, Personal, Casual leave" />
            <p style={{ margin: "7px 0 0", fontSize: 11, color: T.ink3, lineHeight: 1.55 }}>
              Month-end reporting groups leave by exactly this text, so reusing the same wording
              (&quot;Medical&quot; rather than &quot;medical appt&quot;) keeps the totals tidy.
            </p>
          </div>
        )}

        <div>
          <Label>Whose day is this? (optional)</Label>
          <select style={inputStyle} value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })}>
            <option value="">Everyone — applies to the whole workspace</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>{existing && <Btn ghost danger onClick={() => onClear(date)}><Trash2 size={14} /> Clear mark</Btn>}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn ghost onClick={onClose}>Cancel</Btn>
            <Btn disabled={!ready} onClick={() => onSave({
              id: existing?.id, date, type: f.type,
              reason: needsReason ? f.reason.trim() : "", memberId: f.memberId || null,
            })}><Check size={15} /> {existing ? "Update" : "Mark day"}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ---------------------------- MARK A TASK ----------------------------------
 * Item 3's "any specific task that I want to mark". The mark is a display
 * flag only — it never touches the state machine — and carries who it's aimed
 * at so a note left for one person doesn't read as a note to everybody. */
/* ------------------------- COMPLETE TASK MODAL (v9) ------------------------
 * item 3 — the photo is entirely optional; "Complete" fires with or without
 * one, so this never adds friction to the common case of a task that
 * doesn't need a photo. */
const CompleteTaskModal = ({ task, onComplete, onClose }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const onPick = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };
  return (
    <Modal title="Mark complete" subtitle={task.title} onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Photo (optional)</Label>
          <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: T.ink3, lineHeight: 1.5 }}>
            Attach one to track progress in reports — most tasks don't need it.
          </p>
          {preview ? (
            <div style={{ position: "relative" }}>
              <img src={preview} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, border: `1px solid ${T.line}`, display: "block" }} />
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <IconBtn onClick={() => { setFile(null); setPreview(null); }} label="Remove photo" danger><X size={13} /></IconBtn>
              </div>
            </div>
          ) : (
            <label className="pd-press" style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "22px", borderRadius: 12, border: `1.5px dashed ${T.line}`, cursor: "pointer", color: T.ink3, fontSize: 12.5,
            }}>
              <Camera size={16} /> Choose a photo
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={onPick} />
            </label>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onComplete(file)}>
            <Check size={14} /> {file ? "Complete with photo" : "Complete"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

const MarkTaskModal = ({ task, members, groups, onSave, onClose }) => {
  const [f, setF] = useState({
    markLabel: task.markLabel ?? "",
    markScope: task.markScope ?? "self",
    markTargetId: task.markTargetId ?? "",
  });
  const needsTarget = f.markScope === "member" || f.markScope === "group";
  const options = f.markScope === "member" ? members : groups;
  return (
    <Modal title={task.isMarked ? "Edit calendar mark" : "Mark on calendar"} subtitle={task.title} onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Note (shows next to the task)</Label>
          <input style={inputStyle} value={f.markLabel} autoFocus
            onChange={(e) => setF({ ...f, markLabel: e.target.value })}
            placeholder="e.g. Blocking the client demo — do this first" />
        </div>
        <div>
          <Label>Who is this mark for?</Label>
          <select style={inputStyle} value={f.markScope}
            onChange={(e) => setF({ ...f, markScope: e.target.value, markTargetId: "" })}>
            {Object.entries(MARK_SCOPE_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
        </div>
        {needsTarget && (
          <div>
            <Label>{f.markScope === "member" ? "Person" : "Group"}</Label>
            <select style={inputStyle} value={f.markTargetId}
              onChange={(e) => setF({ ...f, markTargetId: e.target.value })}>
              <option value="">Select…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            {task.isMarked && (
              <Btn ghost danger onClick={() => onSave({ isMarked: false, markLabel: "", markScope: null, markTargetId: null })}>
                <X size={14} /> Remove mark
              </Btn>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn ghost onClick={onClose}>Cancel</Btn>
            <Btn disabled={needsTarget && !f.markTargetId} onClick={() => onSave({
              isMarked: true, markLabel: f.markLabel.trim(),
              markScope: f.markScope, markTargetId: f.markTargetId || null,
            })}><Star size={14} /> {task.isMarked ? "Save mark" : "Mark task"}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------- DAY DETAIL --------------------------------- */
const DayDetailModal = ({ date, exceptions, events, tasks, projects, companies, members,
  onAddEvent, onEditEvent, onDeleteEvent, onMarkDay, onMarkTask, onOpenProject, onClose }) => {
  const ex = exceptions.find((x) => x.date === date);
  const exMeta = ex ? EXCEPTION_META[ex.type] ?? EXCEPTION_META.holiday : null;
  const ExIcon = ex ? (isLeaveType(ex.type) ? Palmtree : ex.type === "holiday" ? Sun : Plane) : null;
  const dayEvents = events.filter((e) => e.date === date);
  const dayTasks = tasksDueOn(tasks, date);
  const dayDeadlines = projectDeadlinesOn(projects, date);
  const isToday = date === ymdOf(new Date());
  const dow = new Date(date + "T00:00:00").toLocaleDateString("en", { weekday: "long" });
  const exMember = ex?.memberId ? members.find((m) => m.id === ex.memberId) : null;
  return (
    <Modal title={dow} subtitle={isToday ? `${date} · Today` : date} wide onClose={onClose}>
      <div style={{ display: "grid", gap: 20 }}>
        <button onClick={() => onMarkDay(date)} className="pd-press" style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 13, cursor: "pointer", textAlign: "left",
          background: ex ? exMeta.bg : T.cardSoft, border: `1px solid ${ex ? "transparent" : T.line}`,
        }}>
          {ex ? <ExIcon size={16} style={{ color: exMeta.color }} /> : <CircleDot size={16} style={{ color: T.ink3 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
              {ex ? exMeta.label : "Working day"}
            </div>
            <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
              {ex
                ? [ex.reason && `Reason: ${ex.reason}`, exMember && `For ${exMember.name}`, "Tap to change"]
                    .filter(Boolean).join(" · ")
                : "Tap to mark as holiday, travel, or leave."}
            </div>
          </div>
          <Pencil size={13} style={{ color: T.ink3, flexShrink: 0 }} />
        </button>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Events</span>
            <Btn small ghost onClick={() => onAddEvent(date)}><Plus size={13} /> Add</Btn>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {dayEvents.map((ev) => {
              const meta = EVENT_TYPE_META[ev.type] ?? EVENT_TYPE_META.other;
              const Icon = meta.icon;
              const c = companies.find((x) => x.id === ev.companyId);
              return (
                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12, border: `1px solid ${T.line}` }}>
                  <Chip bg={meta.bg} color={meta.color}><Icon size={11} /> {meta.label}</Chip>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{ev.title}</div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                      {ev.startTime || "—"}{ev.endTime ? `–${ev.endTime}` : ""}{c ? ` · ${c.name}` : ""}{ev.location ? ` · ${ev.location}` : ""}
                    </div>
                  </div>
                  <IconBtn label="Edit event" onClick={() => onEditEvent(ev)}><Pencil size={13} /></IconBtn>
                  <IconBtn label="Delete event" danger onClick={() => onDeleteEvent(ev)}><Trash2 size={13} /></IconBtn>
                </div>
              );
            })}
            {dayEvents.length === 0 && <span style={{ fontSize: 11.5, color: T.ink3 }}>No events on this day.</span>}
          </div>
        </div>

        {dayTasks.length > 0 && (
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Task deadlines</span>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {dayTasks.map((t) => {
                const p = projects.find((x) => x.id === t.projectId);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11,
                    padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.isMarked ? "#F3D19E" : T.line}`,
                    background: t.isMarked ? "#FFFCF6" : "transparent" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                        {p?.name ?? "—"} · {taskAudience(t, members)}{t.markLabel ? ` · ${t.markLabel}` : ""}
                      </div>
                    </div>
                    <IconBtn label={t.isMarked ? "Edit calendar mark" : "Mark on calendar"} onClick={() => onMarkTask(t)}>
                      <Star size={13} style={t.isMarked ? { color: "#D97706", fill: "#D97706" } : undefined} />
                    </IconBtn>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {dayDeadlines.length > 0 && (
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Project deadlines</span>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {dayDeadlines.map((p) => (
                <div key={p.id} className="pd-rise" style={{ padding: "10px 14px", borderRadius: 12, border: `1px solid ${T.line}`, cursor: "pointer" }}
                  onClick={() => onOpenProject(p.id)}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{p.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

/* ============================================================================
 * MONTHLY PRODUCTIVITY REPORT — the self-competitive comparison factor
 * ==========================================================================*/
const Delta = ({ cur, prev, unit = "", invert = false }) => {
  const d = prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
  const up = d >= 0;
  const good = invert ? !up : up;
  if (Math.abs(d) < 0.5) return <Chip>— level with last month</Chip>;
  return (
    <Chip bg={good ? "#F2FADF" : "#FDECEA"} color={good ? "#3F6212" : "#B91C1C"}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? "+" : ""}{d.toFixed(0)}%{unit} vs last month
    </Chip>
  );
};

const BarPair = ({ week, cur, prev, max, mesh }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: 1 }}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110, width: "100%", justifyContent: "center" }}>
      {[{ v: prev, ghost: true }, { v: cur, ghost: false }].map(({ v, ghost }, i) => (
        <div key={i} style={{ position: "relative", width: 16, height: "100%", borderRadius: 6, overflow: "hidden",
          background: T.lineSoft, border: `1px solid ${T.lineSoft}` }}>
          <div className="pd-sand-fill" style={{ position: "absolute", inset: 0,
            transform: `translateY(${100 - (max ? (v / max) * 100 : 0)}%)` }}>
            {ghost
              ? <div style={{ position: "absolute", inset: 0, background: "#D4D4CC" }} />
              : <Mesh mesh={mesh} style={{ position: "absolute", inset: 0 }} />}
          </div>
        </div>
      ))}
    </div>
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3 }}>W{week}</span>
  </div>
);

/* Horizontal labeled bar per productivity category — the in-app equivalent
 * of the table-cell bar chart compileProjectReport puts in the .doc export,
 * so the live view and the downloaded report always agree on the numbers. */
const StatBar = ({ label, value, max, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <span style={{ width: 116, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: T.ink2 }}>{label}</span>
    <div style={{ flex: 1, height: 12, borderRadius: 999, background: T.lineSoft, overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: 999, width: `${max ? (value / max) * 100 : 0}%`, background: color, transition: "width 400ms cubic-bezier(.22,1,.36,1)" }} />
    </div>
    <span className="pd-num" style={{ width: 26, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: T.ink }}>{value}</span>
  </div>
);

/* ------------------------------- GANTT VIEW -------------------------------
 * Timeline bar per task: createdAt → completedAt (or deadline while open),
 * colored by STATE_META so it reads consistently with TaskRow elsewhere.
 * Tasks without a deadline can't be placed on an axis, so they're listed
 * separately rather than drawn as a bar. */
const GANTT_RANGES = [
  { key: "30", label: "Next 30 days" },
  { key: "90", label: "Next 90 days" },
  { key: "all", label: "All" },
];
const GanttView = ({ companies, scopedProjects, members, tasks }) => {
  const [projectFilter, setProjectFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [range, setRange] = useState("30");
  const [activeStates, setActiveStates] = useState(() => new Set(Object.keys(STATE_META)));

  const toggleState = (key) => setActiveStates((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const filteredProjects = projectFilter === "all"
    ? scopedProjects
    : scopedProjects.filter((p) => p.id === projectFilter);
  const projectIds = new Set(filteredProjects.map((p) => p.id));

  const inScope = tasks.filter((t) =>
    projectIds.has(t.projectId) &&
    (assigneeFilter === "all" || t.assigneeId === assigneeFilter) &&
    activeStates.has(t.state));
  const dated = inScope.filter((t) => t.deadline);
  const undated = inScope.filter((t) => !t.deadline);

  const barSpan = (t) => {
    const start = new Date(t.createdAt || t.deadline + "T00:00:00");
    const end = new Date(t.completedAt || t.deadline + "T23:59:59");
    return { start, end: end < start ? start : end };
  };

  const today = new Date();
  let rangeStart, rangeEnd;
  if (range === "all") {
    const spans = dated.map(barSpan);
    rangeStart = spans.length ? new Date(Math.min(...spans.map((s) => s.start.getTime()), today.getTime())) : today;
    rangeEnd = spans.length ? new Date(Math.max(...spans.map((s) => s.end.getTime()), today.getTime())) : new Date(today.getTime() + 30 * 864e5);
  } else {
    rangeStart = today;
    rangeEnd = new Date(today.getTime() + Number(range) * 864e5);
  }
  const rangeMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
  const pctOf = (d) => Math.min(100, Math.max(0, ((d.getTime() - rangeStart.getTime()) / rangeMs) * 100));
  const todayPct = pctOf(today);

  const visibleDated = range === "all" ? dated : dated.filter((t) => {
    const { start, end } = barSpan(t);
    return end >= rangeStart && start <= rangeEnd;
  });

  const exportCsv = () => {
    const rows = [["Project", "Company", "Task", "Assignee", "State", "Start", "Deadline", "Completed", "Weight", "Retries"]];
    for (const t of inScope) {
      const project = scopedProjects.find((p) => p.id === t.projectId);
      const company = companies.find((c) => c.id === project?.companyId);
      const assignee = members.find((m) => m.id === t.assigneeId);
      rows.push([
        project?.name ?? "—", company?.name ?? "—", t.title, assignee?.name ?? "Unassigned",
        STATE_META[t.state]?.label ?? t.state, (t.createdAt || "").slice(0, 10), t.deadline ?? "—",
        (t.completedAt || "").slice(0, 10), t.weight, t.retryCount,
      ]);
    }
    downloadCsv(rows, `gantt-export-${todayIso()}.csv`);
  };

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Monitoring" title="Gantt Chart"
        sub="Every task's timeline, filtered your way."
        action={<Btn small ghost onClick={exportCsv}><Download size={13} /> Export CSV</Btn>} />

      {/* Filters */}
      <Card style={{ padding: 16, marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <select style={{ ...inputStyle, width: "auto", minHeight: 38 }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="all">All projects</option>
          {scopedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={{ ...inputStyle, width: "auto", minHeight: 38 }} value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(STATE_META).map(([key, meta]) => (
            <button key={key} onClick={() => toggleState(key)} className="pd-press" style={{
              minHeight: 30, padding: "0 12px", borderRadius: 9, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${activeStates.has(key) ? meta.color + "55" : T.line}`,
              background: activeStates.has(key) ? meta.bg : T.card,
              color: activeStates.has(key) ? meta.color : T.ink3,
            }}>{meta.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {GANTT_RANGES.map(({ key, label }) => (
            <button key={key} onClick={() => setRange(key)} className="pd-press" style={{
              minHeight: 30, padding: "0 12px", borderRadius: 9, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${range === key ? "rgba(36,51,5,0.12)" : T.line}`,
              background: range === key ? "#F2FADF" : T.card,
              color: range === key ? "#3F6212" : T.ink3,
            }}>{label}</button>
          ))}
        </div>
      </Card>

      {inScope.length === 0 && <Empty text="No tasks match these filters." />}

      {/* One card per project, one row per dated task */}
      {filteredProjects.map((p) => {
        const rows = visibleDated.filter((t) => t.projectId === p.id);
        if (!rows.length) return null;
        const company = companies.find((c) => c.id === p.companyId);
        return (
          <Card key={p.id} style={{ padding: 20, marginBottom: 14 }}>
            <SectionHead title={p.name} action={<Chip>{company?.name ?? "—"}</Chip>} />
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((t) => {
                const { start, end } = barSpan(t);
                const left = pctOf(start);
                const width = Math.max(pctOf(end) - left, 1.2);
                const meta = STATE_META[t.state];
                const assignee = members.find((m) => m.id === t.assigneeId);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 220, flexShrink: 0, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                      <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>{assignee ? assignee.name : "Unassigned"} · due {t.deadline}</div>
                    </div>
                    <div style={{ position: "relative", flex: 1, height: 24, borderRadius: 7, background: T.cardSoft, border: `1px solid ${T.lineSoft}`, overflow: "hidden" }}>
                      {todayPct >= 0 && todayPct <= 100 && (
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${todayPct}%`, width: 1, background: T.ink3, opacity: 0.5, zIndex: 2 }} />
                      )}
                      <div title={`${meta.label} · weight ${t.weight}`} style={{
                        position: "absolute", top: 3, bottom: 3, left: `${left}%`, width: `${width}%`,
                        borderRadius: 5, background: meta.color, minWidth: 4,
                      }} />
                    </div>
                    <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {undated.length > 0 && (
        <>
          <SectionHead title="No deadline set" />
          <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
            {undated.map((t) => {
              const project = scopedProjects.find((p) => p.id === t.projectId);
              const meta = STATE_META[t.state];
              const assignee = members.find((m) => m.id === t.assigneeId);
              return (
                <Card key={t.id} style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{t.title}</div>
                    <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>{project?.name ?? "—"} · {assignee ? assignee.name : "Unassigned"}</div>
                  </div>
                  <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

/* ============================================================================
 * LEADERBOARD — the game layer. Every number on this screen traces back to
 * completed tasks and nothing else; there's no separate "score" to inflate.
 * ==========================================================================*/
const RANK_ICON = [Crown, Medal, Medal]; // 1st, 2nd, 3rd — everyone else just gets a number
const RANK_COLOR = ["#D97706", "#8A8F99", "#B45309"];

/* Sunday-start, same convention monthWindow's own day grid already uses. */
function weekWindowStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

const LeaderboardView = ({ tasks, members }) => {
  const [windowKey, setWindowKey] = useState("month"); // week | month | allTime
  const sinceIso = windowKey === "week" ? weekWindowStart().toISOString()
    : windowKey === "month" ? monthWindow(0).start.toISOString() : null;
  const rows = computeLeaderboard(tasks, members, sinceIso)
    .filter((r) => r.member.competesOnLeaderboard)
    .filter((r) => r.tasksDone > 0 || r.member.roles?.length);
  const leader = rows[0];
  const maxPoints = Math.max(1, ...rows.map((r) => r.points));

  return (
    <div className="pd-fade-in">
      <PageHead kicker="The game layer" title="Leaderboard"
        sub="Points come straight from completed task weight — on time counts double. Nothing here is a separate score to game."
        action={
          <div style={{ display: "flex", gap: 6, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 4, boxShadow: T.shadowSm }}>
            {[["week", "This week"], ["month", "This month"], ["allTime", "All-time"]].map(([key, label]) => {
              const on = windowKey === key;
              return (
                <button key={key} onClick={() => setWindowKey(key)} className="pd-press" style={{
                  minHeight: 34, padding: "0 14px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                  color: on ? "#243305" : T.ink3, border: "none", position: "relative", overflow: "hidden",
                  ...(on ? meshBackground(["#EFFCC9", "#D6F47A", "#BCE95C"]) : { background: "transparent" }),
                }}>
                  {on && <GrainOverlay opacity={0.2} radius={9} />}
                  <span style={{ position: "relative" }}>{label}</span>
                </button>
              );
            })}
          </div>
        } />

      {leader && leader.points > 0 && (
        <Mesh mesh={["#FDEED3", "#FBD38D", "#F6AD55"]} style={{
          borderRadius: 22, padding: "22px 26px", marginBottom: 20,
          border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowMd,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Crown size={28} style={{ color: "#78350F", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#78350F", opacity: 0.75 }}>
                In the lead
              </div>
              <div style={{ fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 700, color: "#4A2A03", marginTop: 2 }}>
                {leader.member.name}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 30, fontWeight: 700, color: "#4A2A03" }}>{leader.points}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#78350F", opacity: 0.7 }}>points</div>
            </div>
          </div>
        </Mesh>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r, i) => {
          const level = levelForPoints(r.points);
          const streak = computeStreak(tasks, r.member.id);
          const RankIcon = i < 3 ? RANK_ICON[i] : null;
          return (
            <Card key={r.member.id} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 28, textAlign: "center", flexShrink: 0 }}>
                {RankIcon
                  ? <RankIcon size={18} style={{ color: RANK_COLOR[i] }} />
                  : <span className="pd-num" style={{ fontSize: 13, fontWeight: 700, color: T.ink3 }}>{i + 1}</span>}
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center",
                background: T.cardSoft, border: `1px solid ${T.line}`, fontSize: 12.5, fontWeight: 600, color: T.ink2 }}>
                {r.member.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{r.member.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <Chip bg={level.color + "1A"} color={level.color}>{level.label}</Chip>
                  {streak > 0 && <Chip bg="#FDF3E3" color="#B45309"><Zap size={10} /> {streak}-day streak</Chip>}
                </div>
              </div>
              {/* Points bar — same visual language as StatBar in Reports, so the
                * game layer still reads as part of the same product. */}
              <div style={{ width: 140, height: 8, borderRadius: 99, background: T.lineSoft, overflow: "hidden", flexShrink: 0 }}>
                <div style={{ width: `${(r.points / maxPoints) * 100}%`, height: "100%", background: level.color, borderRadius: 99,
                  transition: "width 500ms cubic-bezier(.22,1,.36,1)" }} />
              </div>
              <div style={{ textAlign: "right", minWidth: 70, flexShrink: 0 }}>
                <div className="pd-num" style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{r.points}</div>
                <div style={{ fontSize: 10, color: T.ink3 }}>{r.tasksDone} task{r.tasksDone !== 1 ? "s" : ""}</div>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && <Empty text="Nobody's completed a task yet — the board is wide open." />}
      </div>
    </div>
  );
};

/* ============================================================================
 * CHAT — General plus one channel per existing group. Not a separate
 * "channels" concept: group_id null is General, group_id set is that group.
 * ==========================================================================*/
/* ================================= CHAT ====================================
 * Two independent scoping axes now (item 6/8, schema_v14):
 * - "general" / "group:<id>" — the existing open, scope-wide channels
 *   (General = everyone in scope, a group = that department). Unchanged
 *   behavior, still backed by chat_messages.group_id.
 * - "channel:<id>" — a new ad-hoc or DM conversation, visible only to the
 *   people explicitly added to it (chat_channel_members + RLS), created via
 *   "+ New chat" or a "Message privately" whisper from Team. Backed by the
 *   new chat_messages.channel_id.
 * activeKey is a plain string so the tab list can mix both kinds without a
 * discriminated-union prop threading exercise. */
const ChatView = ({ workspaceId, groups, members, memberships, myUserId, myMemberId, readOnly,
  pendingDmMemberId, onConsumePendingDm }) => {
  const [activeKey, setActiveKey] = useState("general");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [channelMembers, setChannelMembers] = useState([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const listRef = useRef(null);
  /* Guards the whisper effect below against firing twice for the same
   * request — both React StrictMode's dev-mode double-invoke and the
   * channels-not-loaded-yet retry (see channelsLoaded) would otherwise each
   * independently decide "no existing DM found" and create a duplicate
   * channel. Keyed by member id so a second, different whisper afterward
   * still runs. */
  const consumedDmRef = useRef(null);

  const groupChannels = [{ id: null, key: "general", name: "General" }, ...groups.map((g) => ({ id: g.id, key: `group:${g.id}`, name: g.name }))];
  const adHocChannels = channels.map((c) => {
    if (c.isDm) {
      const otherMemberId = channelMembers.find((m) => m.channelId === c.id && m.memberId !== myMemberId)?.memberId;
      const other = members.find((m) => m.id === otherMemberId);
      return { key: `channel:${c.id}`, id: c.id, name: other?.name ?? "Direct message", isDm: true };
    }
    return { key: `channel:${c.id}`, id: c.id, name: c.name || "Group chat", isDm: false };
  });

  const loadChannels = () => {
    db.fetchChatChannels().then(({ channels: cs, members: ms }) => {
      setChannels(cs);
      setChannelMembers(ms);
      setChannelsLoaded(true);
    }).catch(() => setChannelsLoaded(true));
  };

  const load = () => {
    const p = activeKey.startsWith("channel:")
      ? db.fetchChannelMessages(activeKey.slice("channel:".length))
      : db.fetchChatMessages(activeKey === "general" ? null : activeKey.slice("group:".length));
    p.then((msgs) => { setMessages(msgs); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { loadChannels(); }, [workspaceId]);
  useEffect(() => {
    const iv = setInterval(loadChannels, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    /* Polling, not Realtime — matches the notification center's cadence
     * decision (see App.jsx's notification effect) but faster, since chat
     * reads as broken at 60s in a way a notification bell doesn't. */
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, workspaceId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  /* item 8 — "Message privately" from a Team card lands here with a target
   * member id; reuse an existing DM with them if one's already loaded,
   * otherwise create one. Waits for channelsLoaded so this doesn't race the
   * initial fetch and wrongly conclude "no existing DM" while channels is
   * still its empty initial value. consumedDmRef makes the whole thing
   * idempotent per member id, so React StrictMode's dev-mode double-invoke
   * (and the channelsLoaded-triggered re-run) can't each independently
   * create their own duplicate channel for the same request. */
  useEffect(() => {
    if (!pendingDmMemberId || !channelsLoaded) return;
    if (consumedDmRef.current === pendingDmMemberId) return;
    consumedDmRef.current = pendingDmMemberId;
    onConsumePendingDm();
    const existing = channels.find((c) => c.isDm && channelMembers.some((m) => m.channelId === c.id && m.memberId === pendingDmMemberId));
    if (existing) { setActiveKey(`channel:${existing.id}`); return; }
    const target = memberships.find((m) => m.memberId === pendingDmMemberId && m.userId);
    const mine = memberships.find((m) => m.memberId === myMemberId && m.userId);
    if (!target || !mine) return; // no account on one side — can't create a channel they could ever read
    db.createChatChannel({ isDm: true, name: null, companyId: null,
      participants: [{ memberId: target.memberId, userId: target.userId }, { memberId: mine.memberId, userId: mine.userId }],
    }).then(({ channel }) => { loadChannels(); setActiveKey(`channel:${channel.id}`); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDmMemberId, channelsLoaded]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      const msg = activeKey.startsWith("channel:")
        ? await db.sendChannelMessage(activeKey.slice("channel:".length), body, myMemberId)
        : await db.sendChatMessage(activeKey === "general" ? null : activeKey.slice("group:".length), body, myMemberId);
      setMessages((ms) => [...ms, msg]);
    } catch (e) {
      setDraft(body); // give the text back so nothing typed is lost
    }
  };
  const remove = async (id) => {
    setMessages((ms) => ms.filter((m) => m.id !== id));
    db.deleteChatMessage(id).catch(load);
  };
  const togglePin = async (m) => {
    const pinned = !m.pinned;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, pinned } : x)));
    try { await db.togglePinChatMessage(m.id, pinned); }
    catch { load(); }
  };

  const createChat = async ({ participants, name, isDm }) => {
    const mine = memberships.find((m) => m.memberId === myMemberId && m.userId);
    const all = mine && !participants.some((p) => p.memberId === mine.memberId)
      ? [...participants, { memberId: mine.memberId, userId: mine.userId }] : participants;
    const { channel } = await db.createChatChannel({ participants: all, name, isDm, companyId: null });
    loadChannels();
    setActiveKey(`channel:${channel.id}`);
    setNewChatOpen(false);
  };

  const activeName = [...groupChannels, ...adHocChannels].find((c) => c.key === activeKey)?.name ?? "General";
  const pinnedHere = messages.filter((m) => m.pinned);

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Team & group chat" title="Chat"
        sub="General is everyone in this workspace; each group gets its own channel — plus private chats just between the people you pick."
        action={<Btn ghost disabled={readOnly} onClick={() => setNewChatOpen(true)}><Plus size={14} /> New chat</Btn>} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {groupChannels.map((c) => {
          const on = activeKey === c.key;
          return (
            <button key={c.key} onClick={() => setActiveKey(c.key)} className="pd-press" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 32, padding: "0 13px", borderRadius: 99, cursor: "pointer",
              fontSize: 12, fontWeight: on ? 600 : 450,
              color: on ? "#243305" : T.ink3,
              background: on ? "#EFFCC9" : T.card,
              border: `1px solid ${on ? "#C9E88A" : T.line}`,
            }}>
              <Hash size={11} /> {c.name}
            </button>
          );
        })}
        {adHocChannels.map((c) => {
          const on = activeKey === c.key;
          return (
            <button key={c.key} onClick={() => setActiveKey(c.key)} className="pd-press" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 32, padding: "0 13px", borderRadius: 99, cursor: "pointer",
              fontSize: 12, fontWeight: on ? 600 : 450,
              color: on ? "#291D52" : T.ink3,
              background: on ? "#EEE9FD" : T.card,
              border: `1px solid ${on ? "#D3C6F8" : T.line}`,
            }}>
              {c.isDm ? <UserCheck size={11} /> : <Users size={11} />} {c.name}
            </button>
          );
        })}
      </div>

      <Card style={{ padding: 0, display: "flex", flexDirection: "column", height: 520 }}>
        {pinnedHere.length > 0 && (
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.lineSoft}`, background: T.cardSoft }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 600,
              letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 6 }}>
              <Pin size={10} /> Pinned
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              {pinnedHere.map((m) => (
                <div key={m.id} style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>
                  {m.body}{m.pinNote ? <span style={{ color: T.ink3 }}> — {m.pinNote}</span> : null}
                </div>
              ))}
            </div>
          </div>
        )}
        <div ref={listRef} className="pd-scroll" style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: T.ink3 }}>Loading…</div>
          ) : messages.length === 0 ? (
            <Empty text="No messages yet — say something." />
          ) : messages.map((m) => {
            const author = members.find((x) => x.id === m.authorMemberId);
            const isMe = m.authorId === myUserId;
            return (
              <div key={m.id} className="pd-msg-row" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center",
                  background: T.cardSoft, border: `1px solid ${T.line}`, fontSize: 11, fontWeight: 600, color: T.ink2 }}>
                  {(author?.name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{author?.name ?? "Someone"}</span>
                    <span className="pd-num" style={{ fontSize: 10.5, color: T.ink3 }}>{relativeTime(m.at)}</span>
                    {!readOnly && (
                      <button onClick={() => togglePin(m)} className="pd-press" title={m.pinned ? "Unpin" : "Pin for the team"} style={{
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                        color: m.pinned ? T.limeDeep : T.ink3, display: "inline-flex",
                      }}><Pin size={11} /></button>
                    )}
                    {isMe && (
                      <button onClick={() => remove(m.id)} className="pd-msg-del" style={{
                        marginLeft: "auto", background: "none", border: "none",
                        cursor: "pointer", color: T.ink3, fontSize: 10.5, padding: 0,
                      }}>Delete</button>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 10, padding: 14, borderTop: `1px solid ${T.lineSoft}` }}>
            <input style={{ ...inputStyle, minHeight: 40 }} value={draft}
              placeholder={`Message ${activeName}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <Btn small disabled={!draft.trim()} onClick={send}><Send size={13} /></Btn>
          </div>
        )}
      </Card>

      {newChatOpen && (
        <NewChatModal members={members} memberships={memberships} myMemberId={myMemberId}
          onSave={createChat} onClose={() => setNewChatOpen(false)} />
      )}
    </div>
  );
};

/* ------------------------------ NEW CHAT MODAL -----------------------------
 * item 6 — an ad-hoc chat with a hand-picked subset of people, or (exactly
 * one pick) a DM. Deliberately its own local modal rather than routed
 * through the app's central `modal` state like every other form here — Chat
 * already owns a meaningful amount of local state (messages, channel list,
 * polling) independently of the rest of the app, and this keeps the whole
 * "who can I even chat with" concern (account-linked members only) in one
 * place rather than threading it up through the top-level component. */
const NewChatModal = ({ members, memberships, myMemberId, onSave, onClose }) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  /* Only people who can actually sign in and read a private channel are
   * offerable — someone on the roster with no linked account could be
   * "added" but would never be able to open it. */
  const linkedUserIdByMember = new Map(memberships.filter((m) => m.userId).map((m) => [m.memberId, m.userId]));
  const candidates = members.filter((m) => m.id !== myMemberId && linkedUserIdByMember.has(m.id));
  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((m) => !q || m.name.toLowerCase().includes(q));

  const toggle = (m) => setSelected((sel) => (sel.some((x) => x.id === m.id) ? sel.filter((x) => x.id !== m.id) : [...sel, m]));
  const isDm = selected.length === 1;
  const ready = selected.length > 0 && (isDm || name.trim());

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const participants = selected.map((m) => ({ memberId: m.id, userId: linkedUserIdByMember.get(m.id) }));
    try { await onSave({ participants, name: isDm ? null : name.trim(), isDm }); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="New chat" onClose={onClose}
      subtitle="Pick one person for a private message, or a few for a group chat only they can see.">
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.ink3, pointerEvents: "none" }} />
          <input style={{ ...inputStyle, paddingLeft: 32 }} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…" />
        </div>
        <div className="pd-scroll" style={{ display: "grid", gap: 7, maxHeight: 240, overflowY: "auto" }}>
          {filtered.map((m) => {
            const on = selected.some((x) => x.id === m.id);
            return (
              <button key={m.id} type="button" onClick={() => toggle(m)} className="pd-press" style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11,
                cursor: "pointer", textAlign: "left",
                background: on ? "#F4FBE3" : T.card, border: `1px solid ${on ? "#C9E88A" : T.line}`,
              }}>
                <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{m.name}</span>
                {on && <Check size={14} style={{ color: T.limeDeep }} />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <span style={{ fontSize: 11.5, color: T.ink3 }}>
              {candidates.length === 0 ? "Nobody else here has an account yet — invite them from People & access first." : "No matches."}
            </span>
          )}
        </div>
        {selected.length > 1 && (
          <div><Label>Group name</Label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Site Leads" /></div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!ready || busy} onClick={submit}>
            <Send size={14} /> {isDm ? "Message privately" : "Create group chat"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

const ReportsView = ({ sessions, tasks, exceptions, projects, companies, onExport }) => {
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month
  const [scopeId, setScopeId] = useState("all");
  const cur = computeMonthlyStats({ sessions, tasks, exceptions }, offset);
  const prev = computeMonthlyStats({ sessions, tasks, exceptions }, offset - 1);
  const ahead = cur.velocity >= prev.velocity;
  const maxBucket = Math.max(1, ...cur.buckets, ...prev.buckets);
  const factor = prev.velocity === 0 ? (cur.velocity > 0 ? 100 : 0) : ((cur.velocity - prev.velocity) / prev.velocity) * 100;

  const best = computeAllTimeBest({ sessions, tasks, exceptions });
  const newBest = best && offset === 0 && cur.velocity >= best.velocity && cur.tasksDone > 0;

  const scopeProject = scopeId === "all" ? null : projects.find((p) => p.id === scopeId);
  const scopedTasks = scopeId === "all" ? tasks : tasks.filter((t) => t.projectId === scopeId);
  const breakdown = computeProductivityBreakdown(scopedTasks);
  const overallProductivity = scopeProject
    ? Math.round(computeSandStack(scopeProject, scopedTasks).fillPercent)
    : breakdown.overallProductivity;
  const breakdownRows = [
    { label: "Due", value: breakdown.due.length, color: "#8A8F99" },
    { label: "Overdue", value: breakdown.overdue.length, color: STATE_META.overdue.color },
    { label: "On time", value: breakdown.onTime.length, color: STATE_META.completed.color },
    { label: "Early", value: breakdown.early.length, color: T.limeDeep },
    { label: "Late", value: breakdown.late.length, color: "#D97706" },
  ];
  const breakdownMax = Math.max(1, ...breakdownRows.map((r) => r.value));

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Self-competition" title="Monthly Report"
        sub="You are only ever racing your previous month."
        action={
          <div style={{ display: "flex", gap: 6, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 4, boxShadow: T.shadowSm }}>
            {[{ o: 0, l: "This month" }, { o: -1, l: "Last month" }].map(({ o, l }) => (
              <button key={o} onClick={() => setOffset(o)} className="pd-press" style={{
                minHeight: 34, padding: "0 14px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                color: offset === o ? "#243305" : T.ink3, border: "none", position: "relative", overflow: "hidden",
                ...(offset === o ? meshBackground(["#EFFCC9", "#D6F47A", "#BCE95C"]) : { background: "transparent" }),
              }}>
                {offset === o && <GrainOverlay opacity={0.2} radius={9} />}
                <span style={{ position: "relative" }}>{l}</span>
              </button>
            ))}
          </div>
        } />

      {/* Hero: the comparison factor */}
      <Mesh mesh={ahead ? THEME_PRESETS[0].mesh : MOLD_MESH} style={{
        borderRadius: 24, padding: "30px 34px", marginBottom: 20,
        border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowMd,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase",
          color: ahead ? "#243305" : MOLD_INK, opacity: 0.65, marginBottom: 10 }}>
          Execution velocity · {cur.label}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <span className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 52, fontWeight: 700, letterSpacing: "-0.04em",
            color: ahead ? "#243305" : MOLD_INK, lineHeight: 1 }}>
            {cur.velocity.toFixed(1)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: ahead ? "#243305" : MOLD_INK, opacity: 0.75 }}>weight / week</span>
          <span className="pd-num" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700,
            color: ahead ? "#3F6212" : "#7F1D1D" }}>
            {ahead ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
            {factor >= 0 ? "+" : ""}{factor.toFixed(0)}% vs {prev.label.split(" ")[0]}
          </span>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: ahead ? "#243305" : MOLD_INK, opacity: 0.7 }}>
          {ahead
            ? "Ahead of your previous self. Keep the stack rising."
            : "Behind last month's pace — the sand remembers. Close the danger loop first."}
        </p>
      </Mesh>

      {/* Personal best — the actual self-competition target, not just last month */}
      {best && (
        <Card style={{ padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center",
            background: newBest ? "#F2FADF" : T.cardSoft, color: newBest ? "#3F6212" : T.ink3 }}>
            <Trophy size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>
              Personal best: <span className="pd-num">{best.velocity.toFixed(1)}</span> weight/week · {best.label}
            </div>
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>
              {newBest
                ? "You're at or above your all-time best this month."
                : `${cur.label} is running at ${best.velocity ? Math.round((cur.velocity / best.velocity) * 100) : 0}% of your best.`}
            </div>
          </div>
          {newBest && <Chip bg="#F2FADF" color="#3F6212">New personal best!</Chip>}
        </Card>
      )}

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Absolute hours", value: cur.hours.toFixed(1) + "h", d: <Delta cur={cur.hours} prev={prev.hours} /> },
          { label: "Weight completed", value: cur.weightDone, d: <Delta cur={cur.weightDone} prev={prev.weightDone} /> },
          { label: "Tasks completed", value: cur.tasksDone, d: <Delta cur={cur.tasksDone} prev={prev.tasksDone} /> },
          { label: "Completed late", value: cur.late, d: <Delta cur={cur.late} prev={prev.late} invert /> },
          { label: "Loss factor", value: Math.round(cur.lossFactor * 100) + "%", d: <Delta cur={cur.lossFactor} prev={prev.lossFactor} invert /> },
          { label: "Leave days", value: cur.leaveDays, d: <Delta cur={cur.leaveDays} prev={prev.leaveDays} invert /> },
        ].map(({ label, value, d }) => (
          <Card key={label} style={{ padding: "18px 20px" }}>
            <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>{value}</div>
            <div style={{ margin: "7px 0 10px", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{label}</div>
            {d}
          </Card>
        ))}
      </div>

      {/* Weekly execution chart: gray = previous month, mesh = selected month */}
      <Card style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.015em", color: T.ink2 }}>
            Weekly execution — {cur.label} vs {prev.label}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <Chip bg="#EDEDE6" color={T.ink2}>{prev.label.split(" ")[0]}</Chip>
            <Chip bg="#F2FADF" color="#3F6212">{cur.label.split(" ")[0]}</Chip>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {cur.buckets.map((v, i) => (
            <BarPair key={i} week={i + 1} cur={v} prev={prev.buckets[i]} max={maxBucket} mesh={THEME_PRESETS[0].mesh} />
          ))}
        </div>
      </Card>

      {/* Productivity breakdown — real-time (reads live task state), scopable
       * to a single project. The same numbers land in the .doc export via
       * compileProjectReport, so what you see here matches what downloads. */}
      <SectionHead title="Productivity breakdown"
        action={
          <select style={{ ...inputStyle, width: "auto", minHeight: 36 }} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        } />
      <Card style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
          <span className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
            {overallProductivity}%
          </span>
          <span style={{ fontSize: 12, color: T.ink3 }}>overall productivity{scopeProject ? ` · ${scopeProject.name}` : ""}</span>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {breakdownRows.map((r) => <StatBar key={r.label} {...r} max={breakdownMax} />)}
        </div>
      </Card>

      {/* Leave & interruption — the month-end "how many days off, and why".
        * Sits next to the productivity numbers deliberately: a month that
        * looks slow reads very differently once you can see six leave days
        * against it. */}
      <SectionHead title={`Leave & interruption — ${cur.label}`} />
      <Card style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: cur.leaveByReason.length ? 20 : 0 }}>
          {[
            { label: "Leave days", value: cur.leaveDays, color: "#7C5CDB" },
            { label: "Holiday / travel", value: cur.interruptionDays, color: "#D97706" },
            { label: "Working days", value: cur.workingDays, color: T.ink },
            { label: "Effective days", value: cur.workingDays - cur.lossDays, color: T.limeDeep },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div className="pd-num" style={{ fontFamily: T.fontDisplay, fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", color }}>{value}</div>
              <div style={{ marginTop: 5, fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{label}</div>
            </div>
          ))}
        </div>
        {cur.leaveByReason.length > 0 ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
              color: T.ink3, marginBottom: 11, paddingTop: 18, borderTop: `1px solid ${T.lineSoft}` }}>
              Leave by reason · {cur.leavePersonDays} person-day{cur.leavePersonDays !== 1 ? "s" : ""}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {cur.leaveByReason.map((r) => (
                <div key={r.reason} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  padding: "10px 13px", borderRadius: 10, border: `1px solid ${T.line}` }}>
                  <Palmtree size={13} style={{ color: "#7C5CDB", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: 600, color: T.ink }}>{r.reason}</span>
                  {r.declared > 0 && <Chip bg={EXCEPTION_META.leave_declared.bg} color={EXCEPTION_META.leave_declared.color}>{r.declared} booked</Chip>}
                  {r.taken > 0 && <Chip bg={EXCEPTION_META.leave_taken.bg} color={EXCEPTION_META.leave_taken.color}>{r.taken} taken</Chip>}
                  <span className="pd-num" style={{ fontSize: 13, fontWeight: 700, color: T.ink, minWidth: 46, textAlign: "right" }}>
                    {r.personDays} day{r.personDays !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ margin: "16px 0 0", fontSize: 12, color: T.ink3, lineHeight: 1.6 }}>
            No leave recorded this month. Mark a day as leave from the Calendar to have it counted here
            — the reason you give is what these rows group by.
          </p>
        )}
      </Card>

      {/* Export */}
      <SectionHead title="Project reports — Word export" />
      <div style={{ display: "grid", gap: 10 }}>
        {projects.map((p) => {
          const c = companies.find((x) => x.id === p.companyId);
          return (
            <Card key={p.id} style={{ padding: "15px 20px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                  {c?.name} · compiles task timelines, the permanent reflection log, and photo attachment links
                </div>
              </div>
              <Btn small ghost onClick={() => onExport(p)}><Download size={13} /> Export .doc</Btn>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------- SHARED ----------------------------------- */
const PageHead = ({ kicker, title, sub, action }) => (
  <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, gap: 20, flexWrap: "wrap" }}>
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: T.ink3, marginBottom: 10 }}>{kicker}</div>
      <h1 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 34, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.05, color: T.ink }}>{title}</h1>
      {sub && <p style={{ margin: "10px 0 0", fontSize: 13.5, color: T.ink2 }}>{sub}</p>}
    </div>
    {action}
  </header>
);
const SectionHead = ({ title, action }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 14px" }}>
    <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.015em", color: T.ink2 }}>{title}</h2>
    {action}
  </div>
);
const Empty = ({ text }) => (
  <div style={{ padding: "44px 20px", textAlign: "center", fontSize: 13, color: T.ink3,
    border: `1px dashed ${T.line}`, borderRadius: 16, background: T.cardSoft }}>{text}</div>
);
