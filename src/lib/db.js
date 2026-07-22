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
 *
 * WORKSPACE SCOPING (schema_v4)
 * -----------------------------
 * Every row belongs to a workspace. RLS already restricts what the database
 * will hand back to workspaces you're a member of, but you can be in several
 * at once, so reads additionally filter to the *active* one and writes must
 * stamp it. Rather than thread a workspaceId argument through all twenty-odd
 * functions, the active workspace is module state: the app sets it once when
 * you pick a workspace, and every query below reads it via ws().
 * ==========================================================================*/

let activeWorkspaceId = null;
export function setActiveWorkspace(id) { activeWorkspaceId = id; }
export function getActiveWorkspace() { return activeWorkspaceId; }
/* Writes go through this so a missing workspace fails loudly at the call site
 * instead of as a null-constraint violation from Postgres two layers down. */
const ws = () => {
  if (!activeWorkspaceId) throw new Error("No active workspace selected");
  return activeWorkspaceId;
};

const notDeleted = (q) => q.is("deleted_at", null);
const inWorkspace = (q) => q.eq("workspace_id", ws());
const scoped = (q) => inWorkspace(notDeleted(q));
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
    notes: r.notes ?? "", external: !!r.is_external, defaultDelegate: !!r.is_default_delegate,
    groupId: r.group_id ?? null, companyIds,
  };
};
const rowToGroup = (r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order });
const rowToEvent = (r) => ({
  id: r.id, title: r.title, type: r.event_type, date: r.event_date,
  startTime: r.start_time ?? "", endTime: r.end_time ?? "",
  companyId: r.company_id ?? "", projectId: r.project_id ?? "",
  location: r.location ?? "", notes: r.notes ?? "", attendeeIds: JSON.parse(r.attendee_ids_json || "[]"),
});
const rowToProject = (r) => ({
  id: r.id, companyId: r.company_id, name: r.name, type: r.type,
  baseline: r.baseline_percent, deadline: r.deadline, locked: !!r.locked_at, status: r.status,
});
const rowToTask = (r) => ({
  id: r.id, projectId: r.project_id, title: r.title, assigneeId: r.assignee_id,
  state: r.state, weight: r.weight, deadline: r.deadline, createdAt: r.created_at,
  retryCount: r.retry_count, completedAt: r.completed_at, completedLate: !!r.completed_late,
  scope: r.scope ?? "individual", assigneeGroupId: r.assignee_group_id ?? null,
  isMarked: !!r.is_marked, markLabel: r.mark_label ?? "",
  markScope: r.mark_scope ?? null, markTargetId: r.mark_target_id ?? null,
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
const rowToException = (r) => ({
  id: r.id, date: r.ex_date, type: r.ex_type, label: r.label ?? "",
  reason: r.reason ?? "", memberId: r.member_id ?? null,
});
const rowToSession = (r) => ({ id: r.id, loginAt: r.login_at, logoutAt: r.logout_at });
const rowToWorkspace = (r) => ({ id: r.id, name: r.name, kind: r.kind, createdBy: r.created_by });
const rowToMembership = (r) => ({
  id: r.id, workspaceId: r.workspace_id, userId: r.user_id, memberId: r.member_id,
  email: r.email, role: r.role, status: r.status,
});

/* ------------------------------ workspaces --------------------------------
 * Runs before anything else on sign-in: claims any invites addressed to this
 * account's email, then lists the workspaces the account can now see. RLS
 * does the filtering, so this returns exactly what you're a member of. */
export async function fetchWorkspaces() {
  /* Claim first — an invite accepted a second ago should show up in the very
   * same load, not only after a manual refresh. A failure here is not fatal:
   * it just means no new invites got attached, and the workspaces you already
   * belong to still load fine.
   *
   * supabase.rpc() returns a PostgrestFilterBuilder — thenable (it has
   * .then, so `await` works) but not a real Promise, so it has no .catch().
   * The two-argument form of .then() is the one method every thenable is
   * guaranteed to have, so it's the portable way to swallow a failure here. */
  await supabase.rpc("claim_workspace_invites").then(null, () => {});

  const [workspaces, memberships] = await Promise.all([
    notDeleted(supabase.from("workspaces").select("*")).then(throwIfError),
    notDeleted(supabase.from("workspace_members").select("*").eq("status", "active")).then(throwIfError),
  ]);
  const { data: userData } = await supabase.auth.getUser();
  const myUid = userData?.user?.id;
  const myRoleByWs = new Map(
    memberships.filter((m) => m.user_id === myUid).map((m) => [m.workspace_id, m.role])
  );
  return workspaces
    .filter((w) => myRoleByWs.has(w.id))
    .map((w) => ({ ...rowToWorkspace(w), myRole: myRoleByWs.get(w.id) }))
    /* Personal workspace first, then team workspaces alphabetically — the
     * solo user's single workspace should never move around on them. */
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1);
}

export async function fetchMemberships(workspaceId) {
  const rows = await notDeleted(
    supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId)
  ).then(throwIfError);
  return rows.filter((r) => r.status !== "removed").map(rowToMembership);
}

export async function createWorkspace(id, name) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error("Not signed in");
  await supabase.from("workspaces").insert({
    id, name, kind: "team", created_by: user.id, updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
  /* The creator's own membership. Without this the workspace exists but
   * is_workspace_member() is false for everyone, including its creator, and
   * the next read would come back empty. */
  await supabase.from("workspace_members").insert({
    id: "wm-" + uid(), workspace_id: id, user_id: user.id, email: (user.email || "").toLowerCase(),
    role: "owner", status: "active", invited_by: user.id,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
  return { id, name, kind: "team", createdBy: user.id, myRole: "owner" };
}

export async function renameWorkspace(id, name) {
  await supabase.from("workspaces").update({ name, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* Invites are addressed to an email, not a user id — the person may not have
 * an account yet. claim_workspace_invites() attaches it on their first
 * sign-in. `memberId` optionally ties them to an existing roster entry so an
 * invited teammate inherits the tasks already assigned to that name. */
export async function inviteToWorkspace(workspaceId, email, role, memberId = null) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "wm-" + uid(), workspace_id: workspaceId, user_id: null,
    member_id: memberId, email: email.trim().toLowerCase(), role, status: "invited",
    invited_by: userData?.user?.id ?? null,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  const { error } = await supabase.from("workspace_members").insert(row);
  if (error) {
    if (/duplicate key|uq_workspace_members/i.test(error.message)) {
      throw new Error(`${email} has already been invited to this workspace`);
    }
    throw new Error(error.message);
  }
  return rowToMembership(row);
}

export async function updateMembershipRole(id, role) {
  await supabase.from("workspace_members")
    .update({ role, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* Tombstoned like everything else in this app rather than hard-deleted, so a
 * removed teammate's name still resolves in old task-transition logs. */
export async function removeMembership(id) {
  const now = nowIso();
  await supabase.from("workspace_members")
    .update({ status: "removed", deleted_at: now, updated_at: now, device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------------- bootstrap -------------------------------- */
export async function fetchBootstrap() {
  const [companies, members, links, groups, projects, tasks, transitions, handoffs, reflections, exceptions, sessions, events] =
    await Promise.all([
      scoped(supabase.from("companies").select("*")).then(throwIfError),
      scoped(supabase.from("team_members").select("*")).then(throwIfError),
      scoped(supabase.from("member_company_links").select("*")).then(throwIfError),
      scoped(supabase.from("member_groups").select("*")).then(throwIfError),
      scoped(supabase.from("projects").select("*")).then(throwIfError),
      scoped(supabase.from("tasks").select("*")).then(throwIfError),
      inWorkspace(supabase.from("task_transitions").select("*")).order("created_at").then(throwIfError),
      scoped(supabase.from("handoffs").select("*")).then(throwIfError),
      inWorkspace(supabase.from("reflections").select("*")).then(throwIfError),
      scoped(supabase.from("calendar_exceptions").select("*")).then(throwIfError),
      scoped(supabase.from("work_sessions").select("*")).then(throwIfError),
      scoped(supabase.from("calendar_events").select("*")).then(throwIfError),
    ]);

  const companyIdsByMember = new Map();
  for (const l of links) {
    if (!companyIdsByMember.has(l.member_id)) companyIdsByMember.set(l.member_id, []);
    companyIdsByMember.get(l.member_id).push(l.company_id);
  }

  return {
    companies: companies.map(rowToCompany),
    members: members.map((r) => rowToMember(r, companyIdsByMember.get(r.id) ?? [])),
    groups: groups.map(rowToGroup),
    projects: projects.map(rowToProject),
    tasks: tasks.map(rowToTask),
    transitions: transitions.map(rowToTransition),
    handoffs: handoffs.map(rowToHandoff),
    reflections: reflections.map(rowToReflection),
    exceptions: exceptions.map(rowToException),
    sessions: sessions.map(rowToSession),
    events: events.map(rowToEvent),
  };
}

/* -------------------------------- companies --------------------------------- */
export async function insertCompany(c) {
  const now = nowIso();
  await supabase.from("companies").insert({
    id: c.id, name: c.name, industry: c.industry || null, location: c.location || null,
    theme_json: JSON.stringify(c.theme), workspace_id: ws(),
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateCompany(c) {
  await supabase.from("companies").update({
    name: c.name, industry: c.industry || null, location: c.location || null,
    theme_json: JSON.stringify(c.theme), updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", c.id).then(throwIfError);
}
export async function softDeleteCompany(id) {
  await supabase.from("companies").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------------ team members --------------------------------- */
export async function insertMember(m) {
  const now = nowIso();
  await supabase.from("team_members").insert({
    id: m.id, name: m.name, roles_json: JSON.stringify({ roles: m.roles, phone: m.phone, email: m.email }),
    notes: m.notes || null, is_external: m.external ? 1 : 0, is_default_delegate: m.defaultDelegate ? 1 : 0,
    group_id: m.groupId || null, workspace_id: ws(),
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateMember(m) {
  await supabase.from("team_members").update({
    name: m.name, roles_json: JSON.stringify({ roles: m.roles, phone: m.phone, email: m.email }),
    notes: m.notes || null, is_external: m.external ? 1 : 0, is_default_delegate: m.defaultDelegate ? 1 : 0,
    group_id: m.groupId || null, updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", m.id).then(throwIfError);
}
export async function softDeleteMember(id) {
  await supabase.from("team_members").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}
/* Diffs the member's company links against the desired set — soft-deletes
 * dropped links, inserts new ones. Mirrors the shape seed.sql already uses. */
export async function setMemberCompanies(memberId, companyIds) {
  const existing = await scoped(supabase.from("member_company_links").select("*").eq("member_id", memberId)).then(throwIfError);
  const now = nowIso();
  const toRemove = existing.filter((l) => !companyIds.includes(l.company_id));
  const toAdd = companyIds.filter((cid) => !existing.some((l) => l.company_id === cid));
  await Promise.all([
    ...toRemove.map((l) => supabase.from("member_company_links")
      .update({ deleted_at: now, updated_at: now, device_id: getDeviceId() }).eq("id", l.id).then(throwIfError)),
    ...toAdd.map((cid) => supabase.from("member_company_links").insert({
      id: uid(), member_id: memberId, company_id: cid, workspace_id: ws(),
      updated_at: now, created_at: now, device_id: getDeviceId(),
    }).then(throwIfError)),
  ]);
}

/* --------------------------------- groups ------------------------------------ */
export async function insertGroup(g) {
  const now = nowIso();
  await supabase.from("member_groups").insert({
    id: g.id, name: g.name, sort_order: g.sortOrder ?? 0, workspace_id: ws(),
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateGroup(g) {
  await supabase.from("member_groups").update({ name: g.name, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", g.id).then(throwIfError);
}
export async function softDeleteGroup(id) {
  await supabase.from("member_groups").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ----------------------------- calendar events -------------------------------- */
export async function insertEvent(e) {
  const now = nowIso();
  await supabase.from("calendar_events").insert({
    id: e.id, title: e.title, event_type: e.type, event_date: e.date,
    start_time: e.startTime || null, end_time: e.endTime || null,
    company_id: e.companyId || null, project_id: e.projectId || null,
    location: e.location || null, notes: e.notes || null,
    attendee_ids_json: JSON.stringify(e.attendeeIds || []), workspace_id: ws(),
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateEvent(e) {
  await supabase.from("calendar_events").update({
    title: e.title, event_type: e.type, event_date: e.date,
    start_time: e.startTime || null, end_time: e.endTime || null,
    company_id: e.companyId || null, project_id: e.projectId || null,
    location: e.location || null, notes: e.notes || null,
    attendee_ids_json: JSON.stringify(e.attendeeIds || []),
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", e.id).then(throwIfError);
}
export async function softDeleteEvent(id) {
  await supabase.from("calendar_events").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* --------------------------------- tasks ----------------------------------- */
export async function insertTask(t) {
  const now = nowIso();
  await supabase.from("tasks").insert({
    id: t.id, project_id: t.projectId, title: t.title, assignee_id: t.assigneeId,
    state: t.state, weight: t.weight, deadline: t.deadline,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    scope: t.scope ?? "individual", assignee_group_id: t.assigneeGroupId || null,
    is_marked: t.isMarked ? 1 : 0, mark_label: t.markLabel || null,
    mark_scope: t.markScope || null, mark_target_id: t.markTargetId || null,
    workspace_id: ws(), updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateTaskState(t) {
  await supabase.from("tasks").update({
    state: t.state, assignee_id: t.assigneeId, deadline: t.deadline,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    scope: t.scope ?? "individual", assignee_group_id: t.assigneeGroupId || null,
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", t.id).then(throwIfError);
}
/* The calendar "mark this task" toggle. Kept apart from updateTaskState so
 * pinning a task on the calendar never has to round-trip the state machine's
 * fields, which the reducer alone is allowed to move. */
export async function updateTaskMark(t) {
  await supabase.from("tasks").update({
    is_marked: t.isMarked ? 1 : 0, mark_label: t.markLabel || null,
    mark_scope: t.markScope || null, mark_target_id: t.markTargetId || null,
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
    note: tr.note ?? null, created_at: tr.at, workspace_id: ws(), device_id: getDeviceId(),
  }).then(throwIfError);
}

/* ------------------------------- handoffs ----------------------------------- */
export async function insertHandoff(h) {
  await supabase.from("handoffs").insert({
    id: h.id, task_id: h.taskId, from_assignee_id: h.fromAssigneeId, to_assignee_id: h.toAssigneeId,
    reason: h.reason, status: h.status, workspace_id: ws(),
    updated_at: h.at, created_at: h.at, device_id: getDeviceId(),
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
    created_at: r.at, workspace_id: ws(), device_id: getDeviceId(),
  }).then(throwIfError);
}

/* -------------------------------- projects ----------------------------------- */
export async function insertProject(p) {
  const now = nowIso();
  await supabase.from("projects").insert({
    id: p.id, company_id: p.companyId, name: p.name, type: p.type,
    baseline_percent: p.baseline, deadline: p.deadline || null,
    locked_at: p.locked ? now : null, status: p.status ?? "active", workspace_id: ws(),
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
 * by id (mirrors the none → holiday → travel → none cycle already in the UI).
 *
 * As of schema_v4 an exception is one of four types. holiday/travel are the
 * original "the calendar ate this day" markers; leave_declared (booked ahead)
 * and leave_taken (used) additionally carry a `reason`, which is what makes
 * the month-end leave breakdown possible, and a `member_id` — null meaning it
 * applies to the whole workspace, which is how every pre-v4 row reads. */
export async function createException(ex) {
  const now = nowIso();
  await supabase.from("calendar_exceptions").insert({
    id: ex.id, ex_date: ex.date, ex_type: ex.type, label: ex.label || "",
    reason: ex.reason || null, member_id: ex.memberId || null,
    workspace_id: ws(), updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateException(ex) {
  await supabase.from("calendar_exceptions").update({
    ex_type: ex.type, label: ex.label || "",
    reason: ex.reason || null, member_id: ex.memberId || null,
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", ex.id).then(throwIfError);
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
    id: session.id, login_at: session.loginAt, logout_at: null, workspace_id: ws(),
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateSessionLogout(id, logoutAt) {
  await supabase.from("work_sessions").update({ logout_at: logoutAt, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ============================================================================
 * THE BOARD (schema_v5) — posts, media, comments, polls, task requests
 * ==========================================================================*/

const rowToPost = (r) => ({
  id: r.id, authorId: r.author_id, authorMemberId: r.author_member_id ?? null,
  kind: r.kind, caption: r.caption ?? "", projectId: r.project_id ?? null,
  taskId: r.task_id ?? null, pinned: !!r.pinned, at: r.created_at,
});
const rowToMedia = (r) => ({
  id: r.id, postId: r.post_id, path: r.storage_path, mediaType: r.media_type, sortOrder: r.sort_order,
});
const rowToComment = (r) => ({
  id: r.id, postId: r.post_id, authorId: r.author_id, authorMemberId: r.author_member_id ?? null,
  body: r.body, at: r.created_at,
});
const rowToPollOption = (r) => ({ id: r.id, postId: r.post_id, label: r.label, sortOrder: r.sort_order });
const rowToPollVote = (r) => ({ id: r.id, postId: r.post_id, optionId: r.option_id, voterId: r.voter_id });
const rowToRequest = (r) => ({
  id: r.id, postId: r.post_id, taskId: r.task_id ?? null, projectId: r.project_id ?? null,
  title: r.title, deadline: r.deadline ?? null, weight: r.weight,
  requestedBy: r.requested_by, assigneeMemberId: r.assignee_member_id ?? null,
  status: r.status, at: r.created_at,
});
const rowToRequestEvent = (r) => ({
  id: r.id, requestId: r.request_id, action: r.action,
  fromMemberId: r.from_member_id ?? null, toMemberId: r.to_member_id ?? null,
  reason: r.reason ?? "", actorId: r.actor_id, at: r.created_at,
});

/* One round-trip for the whole board. The feed is capped rather than fully
 * paginated: a workspace's recent activity is what people actually scroll,
 * and the child tables are then fetched only for the posts in that window so
 * a year-old thread's comments aren't dragged along. */
export async function fetchBoard(limit = 60) {
  const posts = await scoped(supabase.from("posts").select("*"))
    .order("created_at", { ascending: false }).limit(limit).then(throwIfError);
  const ids = posts.map((p) => p.id);
  if (!ids.length) {
    return { posts: [], media: [], comments: [], pollOptions: [], pollVotes: [], requests: [], requestEvents: [] };
  }

  const [media, comments, pollOptions, pollVotes, requests] = await Promise.all([
    scoped(supabase.from("post_media").select("*").in("post_id", ids)).order("sort_order").then(throwIfError),
    scoped(supabase.from("post_comments").select("*").in("post_id", ids)).order("created_at").then(throwIfError),
    scoped(supabase.from("poll_options").select("*").in("post_id", ids)).order("sort_order").then(throwIfError),
    inWorkspace(supabase.from("poll_votes").select("*").in("post_id", ids)).then(throwIfError),
    scoped(supabase.from("task_requests").select("*").in("post_id", ids)).then(throwIfError),
  ]);

  /* The paper trail is keyed by request, not post, so it needs the request ids
   * that the query above just resolved. */
  const requestIds = requests.map((r) => r.id);
  const requestEvents = requestIds.length
    ? await inWorkspace(supabase.from("task_request_events").select("*").in("request_id", requestIds))
        .order("created_at").then(throwIfError)
    : [];

  return {
    posts: posts.map(rowToPost),
    media: media.map(rowToMedia),
    comments: comments.map(rowToComment),
    pollOptions: pollOptions.map(rowToPollOption),
    pollVotes: pollVotes.map(rowToPollVote),
    requests: requests.map(rowToRequest),
    requestEvents: requestEvents.map(rowToRequestEvent),
  };
}

/* --------------------------------- media ---------------------------------
 * Objects live at '<workspace>/<post>/<file>' because the storage policies in
 * schema_v5.sql read that first segment to authorise access. Writing outside
 * the active workspace's folder would be rejected by the bucket, which is the
 * intended safety net rather than something to route around. */
export async function uploadPostMedia(postId, file) {
  const workspaceId = ws();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${workspaceId}/${postId}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from("post-media")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, mediaType: file.type.startsWith("video/") ? "video" : "image" };
}

export async function insertPostMedia(postId, items) {
  if (!items.length) return [];
  const now = nowIso();
  const rows = items.map((m, i) => ({
    id: "pm-" + uid(), post_id: postId, workspace_id: ws(),
    storage_path: m.path, media_type: m.mediaType, sort_order: i,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }));
  await supabase.from("post_media").insert(rows).then(throwIfError);
  return rows.map(rowToMedia);
}

/* The bucket is private, so rendering an image means minting a short-lived
 * signed URL. Batched because a feed of ten posts would otherwise fire fifty
 * separate requests. */
export async function signMediaUrls(paths, expiresIn = 3600) {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from("post-media").createSignedUrls(paths, expiresIn);
  if (error) throw new Error(error.message);
  const out = {};
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
}

/* ---------------------------------- posts --------------------------------- */
export async function insertPost(p) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: p.id, workspace_id: ws(), author_id: userData?.user?.id,
    author_member_id: p.authorMemberId || null,
    kind: p.kind, caption: p.caption || "",
    project_id: p.projectId || null, task_id: p.taskId || null,
    pinned: p.pinned ? 1 : 0, updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  await supabase.from("posts").insert(row).then(throwIfError);
  return rowToPost(row);
}
export async function softDeletePost(id) {
  await supabase.from("posts")
    .update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* -------------------------------- comments -------------------------------- */
export async function insertComment(postId, body, authorMemberId = null) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "cm-" + uid(), post_id: postId, workspace_id: ws(),
    author_id: userData?.user?.id, author_member_id: authorMemberId,
    body, updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  await supabase.from("post_comments").insert(row).then(throwIfError);
  return rowToComment(row);
}

/* ---------------------------------- polls --------------------------------- */
export async function insertPollOptions(postId, labels) {
  const now = nowIso();
  const rows = labels.map((label, i) => ({
    id: "po-" + uid(), post_id: postId, workspace_id: ws(),
    label, sort_order: i, updated_at: now, created_at: now, device_id: getDeviceId(),
  }));
  await supabase.from("poll_options").insert(rows).then(throwIfError);
  return rows.map(rowToPollOption);
}

/* Changing your mind updates the existing row — uq_poll_votes_post_voter
 * makes a second insert impossible, so upsert on that constraint is the
 * whole vote-or-revote path. */
export async function castVote(postId, optionId) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "pv-" + uid(), post_id: postId, option_id: optionId, workspace_id: ws(),
    voter_id: userData?.user?.id, updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  const { error } = await supabase.from("poll_votes")
    .upsert(row, { onConflict: "post_id,voter_id" });
  if (error) throw new Error(error.message);
  return rowToPollVote(row);
}

/* ------------------------------ task requests -----------------------------
 * Every state change writes a task_request_events row. That table has no
 * UPDATE policy, so once written the trail cannot be rewritten — which is
 * what makes it worth putting in a report. */
export async function insertTaskRequest(req) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: req.id, post_id: req.postId, workspace_id: ws(),
    task_id: null, project_id: req.projectId || null,
    title: req.title, deadline: req.deadline || null, weight: req.weight ?? 1,
    requested_by: userData?.user?.id, assignee_member_id: req.assigneeMemberId || null,
    status: "pending", updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  await supabase.from("task_requests").insert(row).then(throwIfError);
  const event = await recordRequestEvent(row.id, {
    action: "requested", toMemberId: req.assigneeMemberId || null, reason: req.reason || "",
  });
  return { request: rowToRequest(row), event };
}

export async function recordRequestEvent(requestId, { action, fromMemberId = null, toMemberId = null, reason = "" }) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "re-" + uid(), request_id: requestId, workspace_id: ws(),
    action, from_member_id: fromMemberId, to_member_id: toMemberId,
    reason: reason || null, actor_id: userData?.user?.id,
    created_at: now, device_id: getDeviceId(),
  };
  await supabase.from("task_request_events").insert(row).then(throwIfError);
  return rowToRequestEvent(row);
}

export async function updateTaskRequest(id, patch) {
  await supabase.from("task_requests").update({
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.assigneeMemberId !== undefined ? { assignee_member_id: patch.assigneeMemberId } : {}),
    ...(patch.taskId !== undefined ? { task_id: patch.taskId } : {}),
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", id).then(throwIfError);
}
