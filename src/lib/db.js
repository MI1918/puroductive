import { supabase } from "./supabaseClient.js";
import { uid, nowIso, getDeviceId } from "./ids.js";

/* ============================================================================
 * Data-access layer — maps the Supabase (snake_case, text-typed) schema onto
 * the camelCase shapes the UI already expects, and back again on write.
 *
 * `version`/`device_id` are legacy columns from the original local-first
 * multi-device sync design (see baseline backup/ARCHITECTURE.md). Now that
 * Supabase is the single shared source of truth, they're written for schema
 * compatibility but not read back or reconciled — device_id just tags which
 * browser made the write, version is left at its column default.
 * ==========================================================================*/

const notDeleted = (q) => q.is("deleted_at", null);
const throwIfError = ({ error, data }) => {
  if (error) throw new Error(error.message);
  return data;
};

/* ------------------------------- mappers ---------------------------------- */
const rowToCompany = (r) => ({
  id: r.id, name: r.name, industry: r.industry, location: r.location,
  theme: JSON.parse(r.theme_json),
});
const rowToMember = (r, companyIds) => {
  const extra = JSON.parse(r.roles_json);
  return {
    id: r.id, name: r.name, roles: extra.roles ?? [], phone: extra.phone ?? "—", email: extra.email ?? "—",
    notes: r.notes ?? "", external: !!r.is_external, defaultDelegate: !!r.is_default_delegate, companyIds,
  };
};
const rowToProject = (r) => ({
  id: r.id, companyId: r.company_id, name: r.name, type: r.type,
  baseline: r.baseline_percent, deadline: r.deadline, locked: !!r.locked_at, status: r.status,
});
const rowToTask = (r) => ({
  id: r.id, projectId: r.project_id, title: r.title, assigneeId: r.assignee_id,
  state: r.state, weight: r.weight, deadline: r.deadline,
  retryCount: r.retry_count, completedAt: r.completed_at, completedLate: !!r.completed_late,
});
const rowToTransition = (r) => ({
  id: r.id, taskId: r.task_id, from: r.from_state, to: r.to_state, event: r.event, note: r.note, at: r.created_at,
});
const rowToHandoff = (r) => ({
  id: r.id, taskId: r.task_id, fromAssigneeId: r.from_assignee_id, toAssigneeId: r.to_assignee_id,
  reason: r.reason, status: r.status, at: r.created_at,
});
const rowToReflection = (r) => ({
  id: r.id, taskId: r.task_id, projectId: r.project_id,
  whatWentWrong: r.what_went_wrong, rootBottleneck: r.root_bottleneck, correctiveAction: r.corrective_action,
  at: r.created_at,
});
const rowToException = (r) => ({ id: r.id, date: r.ex_date, type: r.ex_type, label: r.label ?? "" });
const rowToSession = (r) => ({ id: r.id, loginAt: r.login_at, logoutAt: r.logout_at });

/* ------------------------------- bootstrap -------------------------------- */
export async function fetchBootstrap() {
  const [companies, members, links, projects, tasks, transitions, handoffs, reflections, exceptions, sessions] =
    await Promise.all([
      notDeleted(supabase.from("companies").select("*")).then(throwIfError),
      notDeleted(supabase.from("team_members").select("*")).then(throwIfError),
      notDeleted(supabase.from("member_company_links").select("*")).then(throwIfError),
      notDeleted(supabase.from("projects").select("*")).then(throwIfError),
      notDeleted(supabase.from("tasks").select("*")).then(throwIfError),
      supabase.from("task_transitions").select("*").order("created_at").then(throwIfError),
      notDeleted(supabase.from("handoffs").select("*")).then(throwIfError),
      supabase.from("reflections").select("*").then(throwIfError),
      notDeleted(supabase.from("calendar_exceptions").select("*")).then(throwIfError),
      notDeleted(supabase.from("work_sessions").select("*")).then(throwIfError),
    ]);

  const companyIdsByMember = new Map();
  for (const l of links) {
    if (!companyIdsByMember.has(l.member_id)) companyIdsByMember.set(l.member_id, []);
    companyIdsByMember.get(l.member_id).push(l.company_id);
  }

  return {
    companies: companies.map(rowToCompany),
    members: members.map((r) => rowToMember(r, companyIdsByMember.get(r.id) ?? [])),
    projects: projects.map(rowToProject),
    tasks: tasks.map(rowToTask),
    transitions: transitions.map(rowToTransition),
    handoffs: handoffs.map(rowToHandoff),
    reflections: reflections.map(rowToReflection),
    exceptions: exceptions.map(rowToException),
    sessions: sessions.map(rowToSession),
  };
}

/* --------------------------------- tasks ----------------------------------- */
export async function insertTask(t) {
  const now = nowIso();
  await supabase.from("tasks").insert({
    id: t.id, project_id: t.projectId, title: t.title, assignee_id: t.assigneeId,
    state: t.state, weight: t.weight, deadline: t.deadline,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateTaskState(t) {
  await supabase.from("tasks").update({
    state: t.state, assignee_id: t.assigneeId, deadline: t.deadline,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", t.id).then(throwIfError);
}
export async function softDeleteTask(taskId) {
  await supabase.from("tasks").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", taskId).then(throwIfError);
}

/* ----------------------------- transitions ---------------------------------- */
export async function recordTransition(tr) {
  await supabase.from("task_transitions").insert({
    id: tr.id, task_id: tr.taskId, from_state: tr.from, to_state: tr.to, event: tr.event,
    note: tr.note ?? null, created_at: tr.at, device_id: getDeviceId(),
  }).then(throwIfError);
}

/* ------------------------------- handoffs ----------------------------------- */
export async function insertHandoff(h) {
  await supabase.from("handoffs").insert({
    id: h.id, task_id: h.taskId, from_assignee_id: h.fromAssigneeId, to_assignee_id: h.toAssigneeId,
    reason: h.reason, status: h.status, updated_at: h.at, created_at: h.at, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateHandoffStatus(id, status) {
  await supabase.from("handoffs").update({ status, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------------ reflections --------------------------------- */
export async function insertReflection(r) {
  await supabase.from("reflections").insert({
    id: r.id, task_id: r.taskId, project_id: r.projectId,
    what_went_wrong: r.whatWentWrong, root_bottleneck: r.rootBottleneck, corrective_action: r.correctiveAction,
    created_at: r.at, device_id: getDeviceId(),
  }).then(throwIfError);
}

/* -------------------------------- projects ----------------------------------- */
export async function insertProject(p) {
  const now = nowIso();
  await supabase.from("projects").insert({
    id: p.id, company_id: p.companyId, name: p.name, type: p.type,
    baseline_percent: p.baseline, deadline: p.deadline || null,
    locked_at: p.locked ? now : null, status: p.status ?? "active",
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateProject(p) {
  await supabase.from("projects").update({
    name: p.name, type: p.type, baseline_percent: p.baseline, deadline: p.deadline || null,
    locked_at: p.locked ? nowIso() : null, status: p.status ?? "active",
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", p.id).then(throwIfError);
}

/* --------------------------- calendar exceptions ------------------------------
 * No unique constraint on ex_date in the schema, so exception rows are addressed
 * by id (mirrors the none → holiday → travel → none cycle already in the UI). */
export async function createException(id, date, type) {
  const now = nowIso();
  await supabase.from("calendar_exceptions").insert({
    id, ex_date: date, ex_type: type, label: "",
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function setExceptionType(id, type) {
  await supabase.from("calendar_exceptions")
    .update({ ex_type: type, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}
export async function removeException(id) {
  await supabase.from("calendar_exceptions")
    .update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------------ work sessions --------------------------------- */
export async function insertSession(session) {
  const now = nowIso();
  await supabase.from("work_sessions").insert({
    id: session.id, login_at: session.loginAt, logout_at: null,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateSessionLogout(id, logoutAt) {
  await supabase.from("work_sessions").update({ logout_at: logoutAt, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}
