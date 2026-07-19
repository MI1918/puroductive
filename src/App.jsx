import React, { useState, useEffect, useReducer, useRef } from "react";
import {
  LayoutGrid, FolderKanban, Users, Plus, Trash2, Lock, Phone, Mail, X, Check,
  AlertTriangle, ShieldCheck, Globe, ChevronRight, ChevronLeft, CircleDot,
  Play, PhoneMissed, RotateCcw, UserCheck, CalendarClock, History, ScrollText,
  Ban, Flame, CalendarDays, BarChart3, Bell, Download, LogIn, LogOut, Plane,
  TrendingUp, TrendingDown, Sun,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import * as db from "./lib/db.js";

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
const T = {
  bg: "#F7F7F4", card: "#FFFFFF", cardSoft: "#FCFCFA",
  line: "#E9E9E3", lineSoft: "#F0F0EB",
  ink: "#16181D", ink2: "#5A5F69", ink3: "#9AA0AA",
  lime: "#C6F04D", limeDeep: "#7CB518", danger: "#D9482B",
  fontDisplay: "'Sora', 'Inter', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  shadowSm: "0 1px 2px rgba(22,24,29,0.04), 0 2px 8px rgba(22,24,29,0.04)",
  shadowMd: "0 1px 2px rgba(22,24,29,0.05), 0 8px 24px -8px rgba(22,24,29,0.09)",
  shadowLg: "0 2px 4px rgba(22,24,29,0.05), 0 24px 48px -16px rgba(22,24,29,0.14)",
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")";

/* The moldy overlay the sand degrades into when deadlines are missed. */
const MOLD_MESH = ["#D8D9D2", "#AFB2A6", "#82857A"];
const MOLD_INK = "#3F423A";

const THEME_PRESETS = [
  { key: "lime",    label: "Fresh Lime", primary: "#7CB518", ink: "#243305", mesh: ["#E9FBB7", "#C6F04D", "#8FD14F"] },
  { key: "mint",    label: "Sea Mint",   primary: "#0E9F6E", ink: "#093826", mesh: ["#D9FBEA", "#8FE3BE", "#4CC694"] },
  { key: "apricot", label: "Apricot",    primary: "#D97706", ink: "#4A2A03", mesh: ["#FDEED3", "#FBD38D", "#F6AD55"] },
  { key: "sky",     label: "Glass Sky",  primary: "#0284C7", ink: "#062F44", mesh: ["#DDF3FE", "#A5DFF9", "#67C3F0"] },
  { key: "lilac",   label: "Soft Lilac", primary: "#7C5CDB", ink: "#291D52", mesh: ["#EEE9FD", "#D3C6F8", "#B3A0F2"] },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
export const isPast = (ymd) => !!ymd && new Date(ymd + "T23:59:59") < new Date();

/* ============================================================================
 * ENGINE 1 — TASK STATE MACHINE (ported from core/stateMachine)
 * ==========================================================================*/
export const TRANSITIONS = {
  pending:       { START: "in_progress", FAIL_ATTEMPT: "retry_pending", DEADLINE_PASSED: "overdue" },
  in_progress:   { COMPLETE: "completed", FAIL_ATTEMPT: "retry_pending", DEADLINE_PASSED: "overdue" },
  retry_pending: { REASSIGN: "pending", RESCHEDULE: "pending", COMPLETE: "completed", DEADLINE_PASSED: "overdue" },
  overdue:       { COMPLETE: "completed", FAIL_ATTEMPT: "retry_pending" },
  completed:     {},
};
const STATE_META = {
  pending:       { label: "Pending",       color: "#8A8F99", bg: "#F3F3EE" },
  in_progress:   { label: "In progress",   color: "#0284C7", bg: "#EAF6FE" },
  retry_pending: { label: "Retry pending", color: "#B45309", bg: "#FDF3E3" },
  overdue:       { label: "Overdue",       color: "#B91C1C", bg: "#FDECEA" },
  completed:     { label: "Completed",     color: "#3F6212", bg: "#F2FADF" },
};

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

  // Working days = Mon–Sat inside the window; exceptions are lost days.
  let workingDays = 0, lossDays = 0;
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    workingDays++;
    if (exceptions.some((x) => x.date === ymdOf(d))) lossDays++;
  }
  const lossFactor = workingDays ? lossDays / workingDays : 0;
  const weeks = Math.max(1, (end - start) / (7 * 864e5));
  const velocity = weightDone / weeks; // execution velocity: weight / week

  // Weekly buckets for the chart (days 1-7, 8-14, 15-21, 22-28, 29+).
  const buckets = [0, 0, 0, 0, 0];
  for (const t of done) {
    buckets[Math.min(4, Math.floor((new Date(t.completedAt).getDate() - 1) / 7))] += t.weight;
  }
  return { label, hours, tasksDone: done.length, weightDone, late, workingDays, lossDays, lossFactor, velocity, buckets };
}

/* ============================================================================
 * ENGINE 7 — EXPORT & ANALYTICS (Word/Docx-ready report compiler)
 * compileProjectReport() → { report, docHtml }
 *   · report  — the full structured object (timelines, reflections,
 *               attachment links) for the real Phase-1 docx pipeline
 *   · docHtml — Word-compatible HTML; saved as .doc it opens directly in
 *               MS Word with headings, tables, and the reflection log intact
 * ==========================================================================*/
export function compileProjectReport({ project, company, tasks, transitions, reflections, members }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? "Unassigned";
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const stack = computeSandStack(project, tasks);

  const report = {
    format: "puroductive-project-report",
    generatedAt: new Date().toISOString(),
    company: { name: company?.name, industry: company?.industry, location: company?.location },
    project: { name: project.name, type: project.type, baselinePercent: project.baseline, deadline: project.deadline, deadlineLocked: !!project.locked },
    sandStack: { fillPercent: Math.round(stack.fillPercent), degraded: stack.degraded, completedWeight: stack.completedWeight, totalWeight: stack.totalWeight },
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
  const attachmentBlocks = report.tasks.filter((t) => t.attachmentLinks.length).map((t) =>
    `<li><b>${esc(t.title)}</b>: ${t.attachmentLinks.map((u) => `<a href="${esc(u)}">${esc(u)}</a>`).join(", ")}</li>`).join("");

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
</style></head><body>
<h1>${esc(project.name)}</h1>
<p class="meta">${esc(company?.name ?? "")} · ${esc(company?.location ?? "")} · Generated ${esc(fmt(report.generatedAt))}<br/>
Type: ${esc(project.type === "zero_to_one" ? "Zero → One" : `Ongoing (baseline ${project.baseline}%)`)} ·
Deadline: ${esc(project.deadline ?? "—")}${project.locked ? " (locked)" : ""} ·
Sand stack: <b>${report.sandStack.fillPercent}%</b>${report.sandStack.degraded ? " — DEGRADED" : ""}</p>
<h2>Task Register</h2>
<table class="grid"><tr><th>Task</th><th>State</th><th>Assignee</th><th>Deadline</th><th>Completed</th><th>Retries</th><th>Weight</th></tr>${taskRows}</table>
<h2>Task Timelines</h2>${timelineBlocks || "<p><i>No transitions recorded yet.</i></p>"}
<h2>Supervisor Reflection Log (permanent)</h2>${reflectionBlocks}
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

/* Companies, projects, members, tasks, calendar exceptions and work sessions
 * are now loaded live from Supabase (see lib/db.js) — no seed data here. */

/* ------------------------------ GLOBAL STYLES ----------------------------- */
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;450;500;600&display=swap');
    * { box-sizing: border-box; }
    ::selection { background: #C6F04D; color: #16181D; }
    .pd-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .pd-scroll::-webkit-scrollbar-thumb { background: #DEDED7; border-radius: 8px; }
    .pd-num { font-variant-numeric: tabular-nums; }
    .pd-rise { transition: transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 240ms ease-out; will-change: transform; }
    .pd-rise:hover { transform: translateY(-2px); box-shadow: ${T.shadowLg}; }
    .pd-press:active { transform: scale(0.98); }
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
    @media (prefers-reduced-motion: reduce) {
      .pd-rise, .pd-press, .pd-fade-in, .pd-pop-in, .pd-sand-fill, .pd-shake, .pd-toast { animation: none !important; transition: none !important; }
      .pd-rise:hover { transform: none; }
    }
    input, select, textarea { font-family: inherit; }
    input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
      outline: 2px solid #7CB518; outline-offset: 2px;
    }
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

/* ============================================================================
 * SAND STACK VISUALS — grainy fill rises with completion; molds when degraded.
 * Fill animates via translateY/translateX (GPU) — never height/width.
 * ==========================================================================*/
const SandStackColumn = ({ stack, theme, height = 260 }) => {
  const mesh = stack.degraded ? MOLD_MESH : theme.mesh;
  const pct = Math.round(stack.fillPercent);
  return (
    <div style={{ width: "100%" }}>
      <div style={{
        position: "relative", height, borderRadius: 18, overflow: "hidden",
        background: "#EFEFEA", border: `1px solid ${T.line}`,
        boxShadow: "inset 0 2px 6px rgba(22,24,29,0.06)",
      }}>
        <div className="pd-sand-fill" style={{
          position: "absolute", inset: 0,
          transform: `translateY(${100 - stack.fillPercent}%)`,
        }}>
          <Mesh mesh={mesh} style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
              background: "rgba(255,255,255,0.5)", filter: "blur(1px)" }} />
          </Mesh>
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
          padding: "9px 12px", borderRadius: 11, background: "#FDECEA", border: "1px solid #F5C6BE" }}>
          <Flame size={13} style={{ color: "#B91C1C", flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: "#7F1D1D", lineHeight: 1.45 }}>
            {stack.degradationSources.length} missed task{stack.degradationSources.length > 1 ? "s" : ""} molding the stack.
            Premium color returns only by completing them.
          </span>
        </div>
      )}
    </div>
  );
};

const SandBar = ({ stack, theme }) => {
  const mesh = stack.degraded ? MOLD_MESH : theme.mesh;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 130 }}>
      <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 99, overflow: "hidden",
        background: "#EFEFEA", border: `1px solid ${T.lineSoft}` }}>
        <div className="pd-sand-fill" style={{ position: "absolute", inset: 0, transform: `translateX(${stack.fillPercent - 100}%)` }}>
          <Mesh mesh={mesh} style={{ position: "absolute", inset: 0 }} />
        </div>
      </div>
      <span className="pd-num" style={{ fontSize: 11.5, fontWeight: 600, minWidth: 34, textAlign: "right",
        color: stack.degraded ? "#B91C1C" : T.ink2 }}>{Math.round(stack.fillPercent)}%</span>
    </div>
  );
};

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
        ? { background: "#FDF1EE", color: T.danger, border: "1px solid #F3CFC6" }
        : ghost
        ? { background: "#FFFFFF", color: T.ink2, border: `1px solid ${T.line}`, boxShadow: T.shadowSm }
        : ink
        ? { background: T.ink, color: "#FFFFFF", border: "none", boxShadow: T.shadowMd }
        : { color: "#243305", border: "1px solid rgba(36,51,5,0.12)",
            boxShadow: "0 2px 6px rgba(124,181,24,0.25), 0 10px 24px -10px rgba(124,181,24,0.5)",
            ...meshBackground(["#E9FBB7", "#C6F04D", "#A4E24B"]) }),
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
    background: bg ?? (accent ? `${accent}14` : "#F3F3EE"),
    border: `1px solid ${accent ? accent + "33" : T.line}`,
  }}>{children}</span>
);
const Label = ({ children }) => (
  <span style={{ display: "block", fontSize: 11, fontWeight: 600, letterSpacing: "0.09em",
    textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>{children}</span>
);
const inputStyle = {
  width: "100%", minHeight: 46, padding: "0 14px", borderRadius: 12, fontSize: 14,
  color: T.ink, background: "#FFFFFF", border: `1px solid ${T.line}`,
  boxShadow: "inset 0 1px 2px rgba(22,24,29,0.03)",
};
const IconBtn = ({ children, onClick, label, danger }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label} className="pd-press" style={{
    width: 32, height: 32, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center",
    background: "#FFFFFF", border: `1px solid ${T.line}`, boxShadow: T.shadowSm,
    color: danger ? T.danger : T.ink2, flexShrink: 0,
  }}>{children}</button>
);

/* Modal: dismissible by default; the Strict Supervisor uses locked={true} —
 * no close button, no ESC, no backdrop click. */
const Modal = ({ title, subtitle, onClose, children, wide, locked, tone }) => {
  useEffect(() => {
    if (locked) return;
    const h = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, locked]);
  return (
    <div onClick={locked ? undefined : onClose} style={{
      position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 20,
      background: locked ? "rgba(22,24,29,0.55)" : "rgba(22,24,29,0.32)", backdropFilter: "blur(6px)",
    }}>
      <div className="pd-pop-in pd-scroll" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{
        width: "100%", maxWidth: wide ? 660 : 520, maxHeight: "90vh", overflowY: "auto",
        borderRadius: 22, background: "#FFFFFF",
        border: tone === "danger" ? "1px solid #F3CFC6" : `1px solid ${T.line}`,
        boxShadow: T.shadowLg, padding: 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 20, fontWeight: 600, color: T.ink, letterSpacing: "-0.02em" }}>{title}</h2>
            {subtitle && <p style={{ margin: "5px 0 0", fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          {!locked && onClose && (
            <button onClick={onClose} aria-label="Close" className="pd-press" style={{
              width: 34, height: 34, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center",
              background: "#F5F5F0", border: `1px solid ${T.line}`, color: T.ink2,
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
        background: "#FDECEA", border: "1px solid #F5C6BE" }}>
        <Ban size={17} style={{ color: "#B91C1C", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "#7F1D1D" }}>
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
const ReassignModal = ({ task, members, companies, onConfirm, onClose }) => {
  const raj = members.find((m) => m.defaultDelegate);
  const [toId, setToId] = useState(raj?.id ?? members[0]?.id);
  const [reason, setReason] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  return (
    <Modal title="Reassign task" wide onClose={onClose}
      subtitle="Tasks in retry are never dismissed — they are handed to someone in the pool and tracked until done.">
      <div style={{ display: "grid", gap: 18 }}>
        <div>
          <Label>Hand off to</Label>
          <div style={{ display: "grid", gap: 8 }}>
            {members.map((m) => {
              const on = toId === m.id;
              const co = companies.find((c) => c.id === m.companyIds[0]);
              return (
                <button key={m.id} onClick={() => setToId(m.id)} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 13,
                  cursor: "pointer", textAlign: "left",
                  background: on ? "#F4FBE3" : "#FFFFFF",
                  border: `1px solid ${on ? "#C9E88A" : T.line}`,
                  transition: "background 140ms ease-out",
                }}>
                  <Mesh mesh={co?.theme.mesh ?? THEME_PRESETS[0].mesh} style={{
                    width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
                    border: "1px solid rgba(22,24,29,0.07)",
                  }}>
                    <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 13, color: co?.theme.ink ?? "#243305" }}>{m.name[0]}</span>
                  </Mesh>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      {m.name}
                      {m.defaultDelegate && <Chip accent={T.limeDeep}><ShieldCheck size={10} /> Default delegate</Chip>}
                      {m.external && <Chip><Globe size={10} /> External</Chip>}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{m.roles.join(" · ")}</div>
                  </div>
                  {on && <Check size={16} style={{ color: T.limeDeep }} />}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><Label>Reason</Label>
            <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={`e.g. "Vendor missed call ×${task.retryCount || 1}"`} /></div>
          <div><Label>New attempt deadline</Label>
            <input type="date" min={todayIso()} style={inputStyle} value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Back</Btn>
          <Btn onClick={() => onConfirm({ toAssigneeId: toId, reason, newDeadline: newDeadline || undefined })}>
            <UserCheck size={15} /> Confirm handoff
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

const RescheduleModal = ({ onConfirm, onClose }) => {
  const [d, setD] = useState("");
  return (
    <Modal title="Reschedule attempt" onClose={onClose} subtitle="Same assignee, fresh attempt window.">
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>New attempt deadline</Label>
          <input type="date" min={todayIso()} style={inputStyle} value={d} onChange={(e) => setD(e.target.value)} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Back</Btn>
          <Btn disabled={!d} onClick={() => onConfirm(d)}><CalendarClock size={15} /> Reschedule</Btn>
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
        background: t.kind === "error" ? "#FDECEA" : "#16181D",
        color: t.kind === "error" ? "#7F1D1D" : "#FFFFFF",
        border: t.kind === "error" ? "1px solid #F5C6BE" : "none",
        boxShadow: T.shadowLg, fontSize: 12.5, fontWeight: 500, maxWidth: 360,
      }}>
        {t.kind === "error" ? <AlertTriangle size={14} /> : <Check size={14} style={{ color: T.lime }} />}
        {t.msg}
      </div>
    ))}
  </div>
);

/* =============================== MAIN APP ================================= */
export default function PuroductiveApp({ session }) {
  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
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
  useEffect(() => {
    let cancelled = false;
    db.fetchBootstrap().then((data) => {
      if (cancelled) return;
      setCompanies(data.companies);
      setMembers(data.members);
      setProjects(data.projects);
      setExceptions(data.exceptions);
      setSessions(data.sessions);
      seenTaskIds.current = new Set(data.tasks.map((t) => t.id));
      seenTransitionIds.current = new Set(data.transitions.map((t) => t.id));
      seenReflectionIds.current = new Set(data.reflections.map((r) => r.id));
      seenHandoffStatus.current = new Map(data.handoffs.map((h) => [h.id, h.status]));
      dispatch({ type: "INIT", tasks: data.tasks, transitions: data.transitions, reflections: data.reflections, handoffs: data.handoffs });
      setLoading(false);
    }).catch((err) => { if (!cancelled) { setLoadError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

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
  /* Cycle a calendar day: none → holiday → travel → none. */
  const toggleException = (date) => {
    const cur = exceptions.find((x) => x.date === date);
    if (!cur) {
      const id = uid();
      setExceptions((xs) => [...xs, { id, date, type: "holiday", label: "" }]);
      db.createException(id, date, "holiday").catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else if (cur.type === "holiday") {
      setExceptions((xs) => xs.map((x) => (x.date === date ? { ...x, type: "travel" } : x)));
      db.setExceptionType(cur.id, "travel").catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    } else {
      setExceptions((xs) => xs.filter((x) => x.date !== date));
      db.removeException(cur.id).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
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

  /* ---------------- ENGINE 7 wiring: report export ------------------------ */
  const exportProject = (proj) => {
    const compiled = compileProjectReport({
      project: proj,
      company: companies.find((c) => c.id === proj.companyId),
      tasks: engine.tasks.filter((t) => t.projectId === proj.id),
      transitions: engine.transitions,
      reflections: engine.reflections,
      members,
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
      toast(t.state === "overdue" ? "Completed late — sand restored" : "Task completed");
    }
    if (event === "REASSIGN") toast(`Handed off to ${members.find((m) => m.id === extras.toAssigneeId)?.name}`);
    if (event === "FAIL_ATTEMPT") toast("Moved to Retry Pending — reassign or reschedule", "error");
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
      const project = { ...data, id: uid(), status: "active" };
      setProjects((ps) => [...ps, project]);
      db.insertProject(project).catch((e) => toast(`Sync failed: ${e.message}`, "error"));
    }
    setModal(null);
  };
  /* Task inserts are picked up by the engine.tasks persistence watcher above. */
  const addTask = (task) => { dispatch({ type: "ADD_TASK", task }); setModal(null); };

  const intervention = engine.interventions[0];
  const interventionTask = intervention && engine.tasks.find((t) => t.id === intervention.taskId);
  const scopedProjects = projects.filter((p) => activeCompanyId === "all" || p.companyId === activeCompanyId);
  const openProject = projects.find((p) => p.id === openProjectId);
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const theme = activeCompany ? activeCompany.theme : THEME_PRESETS[0];
  const reassignTask = modal?.kind === "reassign" ? engine.tasks.find((t) => t.id === modal.taskId) : null;

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
    { key: "projects", label: "Projects", icon: FolderKanban },
    { key: "team", label: "Team", icon: Users },
    { key: "calendar", label: "Calendar", icon: CalendarDays },
    { key: "reports", label: "Reports", icon: BarChart3 },
  ];

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

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.fontBody, display: "flex" }}>
      <GlobalStyle />
      <ToastHost toasts={toasts} />

      {/* ------------------------------ SIDEBAR ---------------------------- */}
      <aside style={{
        position: "sticky", top: 0, height: "100vh", width: 232, flexShrink: 0, zIndex: 10,
        display: "flex", flexDirection: "column", padding: "26px 16px",
        borderRight: `1px solid ${T.line}`, background: "#FFFFFF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 8px", marginBottom: 30 }}>
          <Mesh mesh={THEME_PRESETS[0].mesh} style={{
            width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center",
            boxShadow: "0 4px 14px -4px rgba(124,181,24,0.55)", border: "1px solid rgba(36,51,5,0.1)",
          }}>
            <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 17, color: "#243305", display: "grid", placeItems: "center", height: "100%" }}>P</span>
          </Mesh>
          <div>
            <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>Puroductive</div>
            <div style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 1 }}>Workspace OS</div>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = view === key;
            return (
              <button key={key} onClick={() => { setView(key); setOpenProjectId(null); }} className="pd-press" style={{
                position: "relative", overflow: "hidden",
                display: "flex", alignItems: "center", gap: 11, minHeight: 42, padding: "0 12px",
                borderRadius: 11, cursor: "pointer", textAlign: "left",
                fontSize: 13.5, fontWeight: active ? 600 : 450,
                color: active ? "#243305" : T.ink2,
                border: active ? "1px solid rgba(36,51,5,0.1)" : "1px solid transparent",
                boxShadow: active ? "0 2px 8px -2px rgba(124,181,24,0.4)" : "none",
                ...(active ? meshBackground(["#EFFCC9", "#D6F47A", "#BCE95C"]) : { background: "transparent" }),
              }}>
                {active && <GrainOverlay opacity={0.2} radius={11} />}
                <Icon size={16.5} style={{ position: "relative", color: active ? "#3F6212" : T.ink3 }} />
                <span style={{ position: "relative" }}>{label}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: 28 }}>
          <Label>Scope</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[{ id: "all", name: "All companies", theme: THEME_PRESETS[0] }, ...companies].map((c) => {
              const on = activeCompanyId === c.id;
              return (
                <button key={c.id} onClick={() => setActiveCompanyId(c.id)} className="pd-press" style={{
                  display: "flex", alignItems: "center", gap: 9, minHeight: 36, padding: "0 11px",
                  borderRadius: 10, cursor: "pointer", textAlign: "left", fontSize: 12.5,
                  fontWeight: on ? 600 : 450, color: on ? T.ink : T.ink3,
                  background: on ? T.bg : "transparent",
                  border: `1px solid ${on ? T.line : "transparent"}`,
                }}>
                  <CircleDot size={11} style={{ color: c.theme.primary, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <OpenHandoffsPanel handoffs={engine.handoffs} tasks={engine.tasks} members={members} />

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 12px", borderRadius: 12, border: `1px solid ${T.lineSoft}`, background: T.cardSoft }}>
          <span style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session?.user?.email}
          </span>
          <IconBtn label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={13.5} /></IconBtn>
        </div>
      </aside>

      {/* ------------------------------- MAIN ------------------------------ */}
      <main className="pd-scroll" style={{ flex: 1, padding: "34px 40px 60px", maxWidth: 1220, margin: "0 auto", width: "100%" }}>
        {view === "dashboard" && (
          <Dashboard {...{ companies, projects, members, engine, theme }}
            openProject={(id) => { setOpenProjectId(id); setView("projects"); }} />
        )}
        {view === "projects" && !openProject && (
          <ProjectsList projects={scopedProjects} companies={companies} engine={engine}
            onOpen={(p) => setOpenProjectId(p.id)}
            onCreate={() => setModal({ kind: "project", data: null })} />
        )}
        {view === "projects" && openProject && (
          <ProjectDetail project={openProject} companies={companies} members={members} engine={engine}
            onBack={() => setOpenProjectId(null)}
            tryTransition={tryTransition} attemptDelete={attemptDelete}
            onReassign={(t) => setModal({ kind: "reassign", taskId: t.id })}
            onReschedule={(t) => setModal({ kind: "reschedule", taskId: t.id })}
            onAddTask={() => setModal({ kind: "task", projectId: openProject.id })}
            onExport={() => exportProject(openProject)} />
        )}
        {view === "team" && (
          <TeamView members={members} companies={companies} engine={engine} />
        )}
        {view === "calendar" && (
          <CalendarView exceptions={exceptions} toggleException={toggleException}
            sessions={sessions} activeSession={activeSession} clockIn={clockIn} clockOut={clockOut}
            tasks={engine.tasks} alertsOn={alertsOn} enableAlerts={enableAlerts} />
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
        <ReassignModal task={reassignTask} members={members} companies={companies}
          onClose={() => setModal(null)}
          onConfirm={(x) => { tryTransition(reassignTask.id, "REASSIGN", x); setModal(null); }} />
      )}
      {!interventionTask && modal?.kind === "reschedule" && (
        <RescheduleModal onClose={() => setModal(null)}
          onConfirm={(d) => { tryTransition(modal.taskId, "RESCHEDULE", { newDeadline: d }); setModal(null); }} />
      )}
      {!interventionTask && modal?.kind === "task" && (
        <TaskForm projectId={modal.projectId} members={members} onSave={addTask} onClose={() => setModal(null)} />
      )}
      {!interventionTask && modal?.kind === "project" && (
        <ProjectForm data={modal.data} companies={companies} defaultCompanyId={activeCompanyId}
          onSave={saveProject} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

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

/* =============================== DASHBOARD ================================ */
const Dashboard = ({ companies, projects, members, engine, theme, openProject }) => {
  const active = projects.filter((p) => p.status === "active");
  const overdue = engine.tasks.filter((t) => t.state === "overdue");
  const retrying = engine.tasks.filter((t) => t.state === "retry_pending");
  const openHandoffs = engine.handoffs.filter((h) => h.status === "pending");
  const attention = overdue.length + retrying.length;
  return (
    <div className="pd-fade-in">
      <Mesh mesh={attention > 0 ? MOLD_MESH : theme.mesh} style={{
        borderRadius: 24, padding: "32px 36px", marginBottom: 22,
        border: "1px solid rgba(22,24,29,0.07)", boxShadow: T.shadowMd,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase",
          color: attention > 0 ? MOLD_INK : theme.ink, opacity: 0.65, marginBottom: 12 }}>
          Cross-company overview
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
      </Mesh>

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
const ProjectsList = ({ projects, companies, engine, onOpen, onCreate }) => (
  <div className="pd-fade-in">
    <PageHead kicker="Execution" title="Projects"
      sub="Deadlines lock permanently once committed — the supervisor never renegotiates."
      action={<Btn onClick={onCreate}><Plus size={15} /> New project</Btn>} />
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {projects.map((p) => {
        const c = companies.find((x) => x.id === p.companyId);
        const stack = computeSandStack(p, engine.tasks.filter((t) => t.projectId === p.id));
        return (
          <Card key={p.id} className="pd-rise" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 18, cursor: "pointer" }}
            onClick={() => onOpen(p)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, display: "flex", alignItems: "center", gap: 8 }}>
                {p.name} {p.locked && <Lock size={12} style={{ color: T.ink3 }} />}
              </div>
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>{c?.name} · due {p.deadline}</div>
            </div>
            <SandBar stack={stack} theme={c?.theme ?? THEME_PRESETS[0]} />
            <ChevronRight size={15} style={{ color: T.ink3 }} />
          </Card>
        );
      })}
      {projects.length === 0 && <Empty text="No projects in this scope yet." />}
    </div>
  </div>
);

/* ============================ PROJECT DETAIL ============================== */
const ProjectDetail = ({ project, companies, members, engine, onBack, tryTransition, attemptDelete, onReassign, onReschedule, onAddTask, onExport }) => {
  const c = companies.find((x) => x.id === project.companyId);
  const theme = c?.theme ?? THEME_PRESETS[0];
  const tasks = engine.tasks.filter((t) => t.projectId === project.id);
  const stack = computeSandStack(project, tasks);
  const reflections = engine.reflections.filter((r) => r.projectId === project.id);
  const history = engine.transitions.filter((tr) => tasks.some((t) => t.id === tr.taskId)).slice(-6).reverse();
  return (
    <div className="pd-fade-in">
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

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 300px) 1fr", gap: 20, alignItems: "start" }}>
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

        {/* RIGHT — tasks with state-machine actions */}
        <div style={{ display: "grid", gap: 10 }}>
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} members={members}
              tryTransition={tryTransition} attemptDelete={attemptDelete}
              onReassign={onReassign} onReschedule={onReschedule}
              hasReflection={engine.reflections.some((r) => r.taskId === t.id)} />
          ))}
          {tasks.length === 0 && <Empty text="No tasks yet — add the first one." />}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------- TASK ROW --------------------------------- */
const TaskRow = ({ t, members, tryTransition, attemptDelete, onReassign, onReschedule, hasReflection }) => {
  const meta = STATE_META[t.state];
  const m = members.find((x) => x.id === t.assigneeId);
  const acts = [];
  if (TRANSITIONS[t.state].START) acts.push({ k: "START", label: "Start", icon: Play, run: () => tryTransition(t.id, "START") });
  if (TRANSITIONS[t.state].COMPLETE) acts.push({
    k: "COMPLETE", icon: Check, run: () => tryTransition(t.id, "COMPLETE"),
    label: t.state === "overdue" ? (hasReflection ? "Complete (late)" : "Complete — reflection first") : "Complete",
  });
  if (TRANSITIONS[t.state].FAIL_ATTEMPT) acts.push({ k: "FAIL", label: "No answer / failed", icon: PhoneMissed, run: () => tryTransition(t.id, "FAIL_ATTEMPT", { note: "Attempt failed" }) });
  if (TRANSITIONS[t.state].REASSIGN) acts.push({ k: "REASSIGN", label: "Reassign", icon: UserCheck, run: () => onReassign(t) });
  if (TRANSITIONS[t.state].RESCHEDULE) acts.push({ k: "RESCHEDULE", label: "Reschedule", icon: CalendarClock, run: () => onReschedule(t) });

  return (
    <Card style={{
      padding: "16px 18px",
      borderLeft: `3px solid ${t.state === "overdue" ? "#DC2626" : t.state === "retry_pending" ? "#D97706" : t.state === "completed" ? "#84CC16" : T.line}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: t.state === "completed" ? T.ink3 : T.ink,
              textDecoration: t.state === "completed" ? "line-through" : "none" }}>{t.title}</span>
            <Chip bg={meta.bg} color={meta.color}>{meta.label}</Chip>
            {t.completedLate && <Chip bg="#FDF3E3" color="#B45309">Completed late</Chip>}
            {t.retryCount > 0 && t.state !== "completed" && <Chip>{t.retryCount} failed attempt{t.retryCount > 1 ? "s" : ""}</Chip>}
          </div>
          <div className="pd-num" style={{ fontSize: 11.5, color: T.ink3, marginTop: 5 }}>
            {m ? m.name : "Unassigned"}{t.deadline ? ` · due ${t.deadline}` : ""} · weight {t.weight}
          </div>
        </div>
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
    </Card>
  );
};

/* ------------------------------ TASK FORM --------------------------------- */
const TaskForm = ({ projectId, members, onSave, onClose }) => {
  const [f, setF] = useState({ title: "", assigneeId: members[0]?.id ?? "", deadline: "", weight: 1 });
  return (
    <Modal title="Add task" subtitle="A new grain for the stack" onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Title</Label>
          <input style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call vendor for quotation" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 12 }}>
          <div><Label>Assignee</Label>
            <select style={inputStyle} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div><Label>Deadline</Label>
            <input type="date" style={inputStyle} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
          <div><Label>Weight</Label>
            <input type="number" min={1} max={10} style={inputStyle} value={f.weight}
              onChange={(e) => setF({ ...f, weight: Math.max(1, Math.min(10, +e.target.value || 1)) })} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn disabled={!f.title.trim()} onClick={() => onSave({
            id: "t-" + uid(), projectId, title: f.title.trim(), state: "pending",
            assigneeId: f.assigneeId || null, deadline: f.deadline || null, weight: f.weight,
            retryCount: 0, completedAt: null, completedLate: false,
          })}><Check size={15} /> Add task</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------ PROJECT FORM ------------------------------ */
const ProjectForm = ({ data, companies, defaultCompanyId, onSave, onClose }) => {
  const [f, setF] = useState(data ?? {
    name: "", companyId: defaultCompanyId !== "all" ? defaultCompanyId : companies[0]?.id,
    type: "zero_to_one", baseline: 0, deadline: "", locked: false,
  });
  const locked = data?.locked;
  return (
    <Modal title={data ? "Edit project" : "New project"} wide onClose={onClose}
      subtitle={locked ? "Deadline & baseline are locked — immutable by design" : "Phases instantiate from the company template"}>
      <div style={{ display: "grid", gap: 18 }}>
        <div><Label>Project name</Label>
          <input style={inputStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><Label>Company</Label>
            <select style={inputStyle} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} disabled={locked}
              onChange={(e) => setF({ ...f, type: e.target.value, baseline: e.target.value === "zero_to_one" ? 0 : f.baseline })}>
              <option value="zero_to_one">Zero → One (starts empty)</option>
              <option value="ongoing">Ongoing (has baseline)</option>
            </select></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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
          <Btn disabled={!f.name.trim()} onClick={() => onSave(f)}><Check size={15} /> {data ? "Save" : "Create project"}</Btn>
        </div>
      </div>
    </Modal>
  );
};

/* ================================= TEAM =================================== */
const TeamView = ({ members, companies, engine }) => (
  <div className="pd-fade-in">
    <PageHead kicker="Resource pool" title="Team"
      sub="Delegation and follow-ups route through these people. Open handoffs are tracked until answered." />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 16 }}>
      {members.map((m) => {
        const firstCo = companies.find((c) => c.id === m.companyIds[0]);
        const theme = firstCo?.theme ?? THEME_PRESETS[0];
        const initials = m.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        const myOpen = engine.handoffs.filter((h) => h.status === "pending" && h.toAssigneeId === m.id);
        const myTasks = engine.tasks.filter((t) => t.assigneeId === m.id && t.state !== "completed");
        return (
          <Card key={m.id} className="pd-rise" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 15 }}>
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
            </div>
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
          </Card>
        );
      })}
    </div>
  </div>
);

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

const CalendarView = ({ exceptions, toggleException, sessions, activeSession, clockIn, clockOut, tasks, alertsOn, enableAlerts }) => {
  const stats = computeMonthlyStats({ sessions, tasks, exceptions }, 0);
  const { start, end, label } = monthWindow(0);
  const today = ymdOf(new Date());
  const days = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const lead = start.getDay(); // blank cells before day 1 (week starts Sunday)
  const monthSessions = sessions.filter((s) => new Date(s.loginAt) >= start && new Date(s.loginAt) < end);
  const exFor = (ymd) => exceptions.find((x) => x.date === ymd);

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Time & interruption" title="Calendar"
        sub="Tap a day to cycle it: working → holiday → travel. Lost days feed the productivity-loss factor."
        action={<Btn ghost onClick={enableAlerts}><Bell size={14} /> {alertsOn ? "Alerts on · test chime" : "Enable native alerts"}</Btn>} />

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
      </div>

      {/* Month grid */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{label}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <Chip bg="#FDEED3" color="#4A2A03"><Sun size={10} /> Holiday</Chip>
            <Chip bg="#DDF3FE" color="#062F44"><Plane size={10} /> Travel</Chip>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
              textTransform: "uppercase", color: T.ink3, padding: "4px 0" }}>{d}</div>
          ))}
          {Array.from({ length: lead }).map((_, i) => <div key={"b" + i} />)}
          {days.map((d) => {
            const ymd = ymdOf(d);
            const ex = exFor(ymd);
            const isToday = ymd === today;
            const sunday = d.getDay() === 0;
            const worked = monthSessions.some((s) => ymdOf(new Date(s.loginAt)) === ymd);
            return (
              <button key={ymd} onClick={() => !sunday && toggleException(ymd)} className="pd-press"
                title={ex ? `${ex.type}${ex.label ? " · " + ex.label : ""}` : sunday ? "Sunday (off)" : "Tap to mark holiday/travel"}
                style={{
                  position: "relative", overflow: "hidden", minHeight: 62, borderRadius: 12,
                  cursor: sunday ? "default" : "pointer", textAlign: "left", padding: "8px 9px",
                  border: `1px solid ${isToday ? T.limeDeep : T.line}`,
                  boxShadow: isToday ? "0 0 0 3px rgba(124,181,24,0.18)" : "none",
                  opacity: sunday ? 0.45 : 1,
                  background: "#FFFFFF",
                  ...(ex ? meshBackground(ex.type === "holiday" ? ["#FDEED3", "#FBD38D", "#F6AD55"] : ["#DDF3FE", "#A5DFF9", "#67C3F0"]) : {}),
                }}>
                {ex && <GrainOverlay opacity={0.2} radius={12} />}
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
                  <span className="pd-num" style={{ fontSize: 12.5, fontWeight: 600, color: ex ? (ex.type === "holiday" ? "#4A2A03" : "#062F44") : T.ink }}>
                    {d.getDate()}
                  </span>
                  {ex && (ex.type === "holiday" ? <Sun size={12} style={{ color: "#4A2A03" }} /> : <Plane size={12} style={{ color: "#062F44" }} />)}
                  {!ex && worked && <span style={{ width: 5, height: 5, borderRadius: 99, background: T.limeDeep }} title="Session logged" />}
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
    </div>
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
          background: "#EFEFEA", border: `1px solid ${T.lineSoft}` }}>
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

const ReportsView = ({ sessions, tasks, exceptions, projects, companies, onExport }) => {
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month
  const cur = computeMonthlyStats({ sessions, tasks, exceptions }, offset);
  const prev = computeMonthlyStats({ sessions, tasks, exceptions }, offset - 1);
  const ahead = cur.velocity >= prev.velocity;
  const maxBucket = Math.max(1, ...cur.buckets, ...prev.buckets);
  const factor = prev.velocity === 0 ? (cur.velocity > 0 ? 100 : 0) : ((cur.velocity - prev.velocity) / prev.velocity) * 100;

  return (
    <div className="pd-fade-in">
      <PageHead kicker="Self-competition" title="Monthly Report"
        sub="You are only ever racing your previous month."
        action={
          <div style={{ display: "flex", gap: 6, background: "#FFFFFF", border: `1px solid ${T.line}`, borderRadius: 12, padding: 4, boxShadow: T.shadowSm }}>
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

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Absolute hours", value: cur.hours.toFixed(1) + "h", d: <Delta cur={cur.hours} prev={prev.hours} /> },
          { label: "Weight completed", value: cur.weightDone, d: <Delta cur={cur.weightDone} prev={prev.weightDone} /> },
          { label: "Tasks completed", value: cur.tasksDone, d: <Delta cur={cur.tasksDone} prev={prev.tasksDone} /> },
          { label: "Completed late", value: cur.late, d: <Delta cur={cur.late} prev={prev.late} invert /> },
          { label: "Loss factor", value: Math.round(cur.lossFactor * 100) + "%", d: <Delta cur={cur.lossFactor} prev={prev.lossFactor} invert /> },
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
