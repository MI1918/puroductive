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
  theme: JSON.parse(r.theme_json), sortOrder: r.sort_order ?? null,
});
const rowToMember = (r, companyIds) => {
  const extra = JSON.parse(r.roles_json);
  return {
    id: r.id, name: r.name, roles: extra.roles ?? [], phone: extra.phone ?? "—", email: extra.email ?? "—",
    notes: r.notes ?? "", external: !!r.is_external, defaultDelegate: !!r.is_default_delegate,
    groupId: r.group_id ?? null, companyIds,
    competesOnLeaderboard: r.competes_on_leaderboard === undefined ? true : !!r.competes_on_leaderboard,
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
  sortOrder: r.sort_order ?? null,
});
const rowToTask = (r) => ({
  id: r.id, projectId: r.project_id, title: r.title, assigneeId: r.assignee_id,
  state: r.state, weight: r.weight, deadline: r.deadline, deadlineTime: r.deadline_time ?? null, createdAt: r.created_at,
  retryCount: r.retry_count, completedAt: r.completed_at, completedLate: !!r.completed_late,
  scope: r.scope ?? "individual", assigneeGroupId: r.assignee_group_id ?? null,
  isMarked: !!r.is_marked, markLabel: r.mark_label ?? "",
  markScope: r.mark_scope ?? null, markTargetId: r.mark_target_id ?? null,
  queueOrder: r.queue_order ?? null, personalQueueOrder: r.personal_queue_order ?? null,
  estimatedMinutes: r.estimated_minutes ?? null, activeMinutes: r.active_minutes ?? 0,
  startedAt: r.started_at ?? null, completionPhotoPath: r.completion_photo_path ?? null,
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
const rowToDeadlineExtension = (r) => ({
  id: r.id, taskId: r.task_id, projectId: r.project_id,
  oldDeadline: r.old_deadline, newDeadline: r.new_deadline,
  whatChanged: r.what_changed, progressSoFar: r.progress_so_far, planToHold: r.plan_to_hold,
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
  /* Claim first — an invite linked a second ago should show up in the very
   * same load, not only after a manual refresh. A failure here is not
   * fatal: it just means no new invites got linked, and the workspaces you
   * already belong to still load fine.
   *
   * supabase.rpc() returns a PostgrestFilterBuilder — thenable (it has
   * .then, so `await` works) but not a real Promise, so it has no .catch().
   * The two-argument form of .then() is the one method every thenable is
   * guaranteed to have, so it's the portable way to swallow a failure here.
   *
   * Since schema_v6, this only LINKS a matching invite to this account —
   * it no longer activates it. Joining now requires acceptWorkspaceInvite(),
   * surfaced through the notification center (fetchNotifications() below),
   * not a toast here — a toast can't wait for you to come back and decide,
   * a notification can. */
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
  const list = workspaces
    .filter((w) => myRoleByWs.has(w.id))
    .map((w) => ({ ...rowToWorkspace(w), myRole: myRoleByWs.get(w.id) }))
    /* Personal workspace first, then team workspaces alphabetically — the
     * solo user's single workspace should never move around on them. */
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1);
  return list;
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

/* Sends the actual invite email, via the invite-member Edge Function —
 * inviteToWorkspace() above only ever wrote a database row, nothing was ever
 * emailed. Call this AFTER inviteToWorkspace() succeeds, never before: if the
 * membership row doesn't exist yet and this throws, there'd be nothing for
 * the person to land in even if the email went out. If this fails after the
 * row already exists, the invite still works the old way — silently linked
 * on their next sign-in — just without an email telling them to look. */
export async function sendWorkspaceInviteEmail(workspaceId, email, role) {
  const { data, error } = await supabase.functions.invoke("invite-member", {
    body: { workspaceId, email, role },
  });
  if (error) {
    /* On a non-2xx response supabase-js's own error.message is a generic
     * "Edge Function returned a non-2xx status code" — the actual reason
     * (e.g. "Only workspace owners/admins can send invites") is in the JSON
     * body the function returned, reachable only through error.context, the
     * raw Response object. Falling back to the generic message if the body
     * isn't there or isn't JSON. */
    let detail = error.message;
    if (error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      } catch { /* body wasn't JSON — keep the generic message */ }
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return { alreadyHadAccount: !!data?.alreadyHadAccount };
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

/* ------------------------------ notifications ------------------------------
 * User-scoped, not workspace-scoped — the whole point of an invite_pending
 * row is to reach someone who isn't an active member of that workspace yet,
 * so this deliberately does not go through ws()/scoped() like every other
 * read in this file. */
const rowToNotification = (r) => ({
  id: r.id, workspaceId: r.workspace_id ?? null, kind: r.kind,
  title: r.title, body: r.body ?? "",
  actionMembershipId: r.action_membership_id ?? null,
  actionTaskId: r.action_task_id ?? null,
  actionProjectId: r.action_project_id ?? null,
  readAt: r.read_at ?? null, at: r.created_at,
});

export async function fetchNotifications() {
  const rows = await supabase.from("notifications").select("*")
    .is("dismissed_at", null).order("created_at", { ascending: false }).limit(50)
    .then(throwIfError);
  return rows.map(rowToNotification);
}

export async function markNotificationRead(id) {
  await supabase.from("notifications").update({ read_at: nowIso() }).eq("id", id).then(throwIfError);
}

/* Swipe/dismiss. Tombstoned like everything else here — dismissing hides it
 * from fetchNotifications() without erasing the record. */
export async function dismissNotification(id) {
  await supabase.from("notifications").update({ dismissed_at: nowIso() }).eq("id", id).then(throwIfError);
}

/* "Ask an admin" for Google Calendar access (schema_v17) — notifies every
 * active owner/admin of the workspace, so someone blocked by Google's
 * unverified-app screen has a way to reach whoever can actually fix it. */
export async function requestGoogleCalendarAccess(workspaceId) {
  const { error } = await supabase.rpc("request_google_calendar_access", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
}

/* Both go through RPCs rather than a plain update, because the row being
 * changed (workspace_members) isn't gated by "is this yours" RLS the way
 * notifications are — see schema_v6.sql's accept/decline functions for why
 * this needed a SECURITY DEFINER function instead of a looser policy. */
export async function acceptInvite(membershipId) {
  const { data, error } = await supabase.rpc("accept_workspace_invite", { p_membership_id: membershipId });
  if (error) throw new Error(error.message);
  return data; // the workspace_id, so the caller can switch straight to it
}
export async function declineInvite(membershipId) {
  const { error } = await supabase.rpc("decline_workspace_invite", { p_membership_id: membershipId });
  if (error) throw new Error(error.message);
}

/* ---------------------------------- chat -----------------------------------
 * A message with group_id null is the workspace-wide "General" channel;
 * group_id set scopes it to that existing team_members group. No separate
 * channels table — groups already are the team-subdivision concept this
 * would otherwise duplicate. */
const rowToMessage = (r) => ({
  id: r.id, workspaceId: r.workspace_id, groupId: r.group_id ?? null,
  authorId: r.author_id, authorMemberId: r.author_member_id ?? null,
  body: r.body, at: r.created_at,
});

export async function fetchChatMessages(groupId, limit = 100) {
  let q = scoped(supabase.from("chat_messages").select("*"));
  q = groupId ? q.eq("group_id", groupId) : q.is("group_id", null);
  const rows = await q.order("created_at", { ascending: false }).limit(limit).then(throwIfError);
  return rows.reverse().map(rowToMessage); // oldest first for a chat feed
}

export async function sendChatMessage(groupId, body, authorMemberId = null) {
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "cm-" + uid(), workspace_id: ws(), group_id: groupId || null,
    author_id: userData?.user?.id, author_member_id: authorMemberId,
    body, updated_at: now, created_at: now, device_id: getDeviceId(),
  };
  await supabase.from("chat_messages").insert(row).then(throwIfError);
  return rowToMessage(row);
}

export async function deleteChatMessage(id) {
  await supabase.from("chat_messages")
    .update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* --------------------------- Google Calendar sync --------------------------
 * All three calls go through supabase.functions.invoke(), which attaches
 * the current session's Authorization header automatically — none of these
 * pass a token explicitly. */
const rowToGoogleConnection = (r) => ({
  id: r.id, workspaceId: r.workspace_id, googleEmail: r.google_email ?? null,
  connectedAt: r.connected_at, lastSyncedAt: r.last_synced_at ?? null,
  autoSync: !!r.auto_sync,
});

/* Same non-2xx error-body gotcha as sendWorkspaceInviteEmail() — see that
 * function's comment. Pulled out here since three functions in this file
 * now need it. */
async function readFunctionError(error) {
  if (!error) return null;
  if (error.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch { /* body wasn't JSON */ }
  }
  return error.message;
}

export async function fetchGoogleConnection() {
  const row = await scoped(supabase.from("google_calendar_connections").select("*"))
    .maybeSingle().then(throwIfError);
  return row ? rowToGoogleConnection(row) : null;
}

/* Returns the Google consent URL to send the browser to — the caller does
 * `window.location.href = authUrl`, a full top-level navigation away from
 * the app. There's no way around leaving the SPA for this: Google's consent
 * screen can't be shown in an iframe or a fetch response. */
export async function startGoogleConnect(workspaceId) {
  const { data, error } = await supabase.functions.invoke("google-oauth-start", { body: { workspaceId } });
  if (error) throw new Error((await readFunctionError(error)) || "Could not start Google sign-in");
  if (data?.error) throw new Error(data.error);
  return data.authUrl;
}

export async function syncGoogleCalendar(workspaceId) {
  const { data, error } = await supabase.functions.invoke("google-calendar-sync", { body: { workspaceId } });
  if (error) throw new Error((await readFunctionError(error)) || "Sync failed");
  if (data?.error) throw new Error(data.error);
  return data; // { pulled, deleted, pushed }
}

/* Disconnecting is the one write on this table the client does directly —
 * everything else goes through the Edge Functions on the service role. */
export async function disconnectGoogleCalendar(id) {
  await supabase.from("google_calendar_connections")
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq("id", id).then(throwIfError);
}
/* item 5 — the true-background toggle (schema_v11.sql). google-calendar-cron
 * (pg_cron, every 15 min) picks up any connection with this on, independent
 * of whether anyone has the app open — see the while-open 3-minute poll in
 * App.jsx, which is separate and keeps running regardless of this flag. */
export async function setGoogleAutoSync(id, on) {
  await supabase.from("google_calendar_connections")
    .update({ auto_sync: on ? 1 : 0, updated_at: nowIso() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------- clock automation tokens (v10) -------------------
 * item 1 — personal webhook tokens for phone-side clock-in/out automation
 * (Apple Shortcuts natively, Android via Tasker/Automate/IFTTT). The raw
 * token only ever exists client-side at generation time; only its SHA-256
 * hash is stored, computed here with the same algorithm clock-webhook uses
 * server-side so the two can compare. */
async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const rowToAutomationToken = (r) => ({
  id: r.id, workspaceId: r.workspace_id, label: r.label,
  lastUsedAt: r.last_used_at ?? null, createdAt: r.created_at,
});

export async function listAutomationTokens() {
  // automation_tokens has no deleted_at column (revoked_at is its tombstone
  // instead), so this uses inWorkspace() rather than scoped().
  const rows = await inWorkspace(supabase.from("automation_tokens").select("*"))
    .order("created_at", { ascending: false }).then(throwIfError);
  return rows.filter((r) => !r.revoked_at).map(rowToAutomationToken);
}

/* Returns { token, record } — `token` (the raw, usable webhook value) is
 * shown to the user exactly once by the caller and never requested again;
 * only `record` (no raw token) is ever re-fetched afterwards. */
export async function createAutomationToken(label, memberId = null) {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(raw);
  const now = nowIso();
  const { data: userData } = await supabase.auth.getUser();
  const row = {
    id: "at-" + uid(), workspace_id: ws(), user_id: userData?.user?.id,
    member_id: memberId, label: label?.trim() || "Clock automation", token_hash: tokenHash,
    updated_at: now, created_at: now,
  };
  await supabase.from("automation_tokens").insert(row).then(throwIfError);
  return { token: raw, record: rowToAutomationToken(row) };
}

export async function revokeAutomationToken(id) {
  await supabase.from("automation_tokens")
    .update({ revoked_at: nowIso(), updated_at: nowIso() }).eq("id", id).then(throwIfError);
}

/* ------------------------------- bootstrap -------------------------------- */
export async function fetchBootstrap() {
  const [companies, members, links, groups, projects, tasks, transitions, handoffs, reflections, deadlineExtensions, exceptions, sessions, events] =
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
      inWorkspace(supabase.from("deadline_extensions").select("*")).then(throwIfError),
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
    deadlineExtensions: deadlineExtensions.map(rowToDeadlineExtension),
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
    theme_json: JSON.stringify(c.theme), sort_order: c.sortOrder ?? null, workspace_id: ws(),
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
/* Drag-reorder — its own call, same shape as updateTaskQueueOrder below,
 * so a reorder never round-trips the rest of the company's fields. */
export async function updateCompanyOrder(id, sortOrder) {
  await supabase.from("companies").update({ sort_order: sortOrder, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}

/* ------------------------------ team members --------------------------------- */
export async function insertMember(m) {
  const now = nowIso();
  await supabase.from("team_members").insert({
    id: m.id, name: m.name, roles_json: JSON.stringify({ roles: m.roles, phone: m.phone, email: m.email }),
    notes: m.notes || null, is_external: m.external ? 1 : 0, is_default_delegate: m.defaultDelegate ? 1 : 0,
    group_id: m.groupId || null, workspace_id: ws(),
    competes_on_leaderboard: m.competesOnLeaderboard === false ? 0 : 1,
    updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateMember(m) {
  await supabase.from("team_members").update({
    name: m.name, roles_json: JSON.stringify({ roles: m.roles, phone: m.phone, email: m.email }),
    notes: m.notes || null, is_external: m.external ? 1 : 0, is_default_delegate: m.defaultDelegate ? 1 : 0,
    group_id: m.groupId || null, competes_on_leaderboard: m.competesOnLeaderboard === false ? 0 : 1,
    updated_at: nowIso(), device_id: getDeviceId(),
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
    state: t.state, weight: t.weight, deadline: t.deadline, deadline_time: t.deadlineTime || null,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    scope: t.scope ?? "individual", assignee_group_id: t.assigneeGroupId || null,
    is_marked: t.isMarked ? 1 : 0, mark_label: t.markLabel || null,
    mark_scope: t.markScope || null, mark_target_id: t.markTargetId || null,
    queue_order: t.queueOrder ?? null, personal_queue_order: t.personalQueueOrder ?? null,
    estimated_minutes: t.estimatedMinutes ?? null, active_minutes: t.activeMinutes ?? 0,
    started_at: t.startedAt ?? null, completion_photo_path: t.completionPhotoPath ?? null,
    workspace_id: ws(), updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateTaskState(t) {
  await supabase.from("tasks").update({
    state: t.state, assignee_id: t.assigneeId, deadline: t.deadline, deadline_time: t.deadlineTime || null,
    retry_count: t.retryCount, completed_at: t.completedAt, completed_late: t.completedLate ? 1 : 0,
    scope: t.scope ?? "individual", assignee_group_id: t.assigneeGroupId || null,
    active_minutes: t.activeMinutes ?? 0, started_at: t.startedAt ?? null,
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
/* Drag-reorder writes — deliberately its own call, never round-tripping the
 * whole state machine payload above it. Either field may be omitted (a task
 * dragged in a project pipeline that isn't personally queued, or vice versa). */
export async function updateTaskQueueOrder(taskId, { queueOrder, personalQueueOrder } = {}) {
  const patch = { updated_at: nowIso(), device_id: getDeviceId() };
  if (queueOrder !== undefined) patch.queue_order = queueOrder;
  if (personalQueueOrder !== undefined) patch.personal_queue_order = personalQueueOrder;
  await supabase.from("tasks").update(patch).eq("id", taskId).then(throwIfError);
}
/* Editing a task's own details (title/assignee/weight/duration/deadline) —
 * deliberately separate from updateTaskState, which owns the state
 * machine's fields. TaskForm only lets the deadline DATE through here while
 * it's still unset (once a task has a committed deadline, TaskForm disables
 * that field and moving it has to go through extendDeadline's reflective
 * flow instead), but that's a UI policy, not a column restriction here. */
export async function updateTaskDetails(t) {
  await supabase.from("tasks").update({
    title: t.title, assignee_id: t.assigneeId, assignee_group_id: t.assigneeGroupId || null,
    scope: t.scope ?? "individual", deadline: t.deadline || null, deadline_time: t.deadlineTime || null,
    weight: t.weight, estimated_minutes: t.estimatedMinutes ?? null,
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", t.id).then(throwIfError);
}
export async function softDeleteTask(taskId) {
  await supabase.from("tasks").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", taskId).then(throwIfError);
}

/* ------------------------- task completion photo (v9) ----------------------
 * Optional — most tasks never call this. Mirrors uploadPostMedia's path
 * convention ('<workspace>/<parent>/<file>') against the separate
 * 'task-media' bucket, so the same storage RLS shape (schema_v9.sql) applies. */
export async function uploadTaskCompletionPhoto(taskId, file) {
  const workspaceId = ws();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${workspaceId}/${taskId}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from("task-media")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}
export async function attachTaskCompletionPhoto(taskId, path) {
  await supabase.from("tasks").update({ completion_photo_path: path, updated_at: nowIso(), device_id: getDeviceId() })
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

/* ------------------------- deadline extensions (v15) -------------------------
 * A voluntary, before-the-fact deadline move — distinct from reflections,
 * which only ever follow an actual miss. No update/delete policy exists on
 * this table (schema_v15.sql), so once written a row can never change. */
export async function insertDeadlineExtension(e) {
  await supabase.from("deadline_extensions").insert({
    id: e.id, task_id: e.taskId, project_id: e.projectId,
    old_deadline: e.oldDeadline, new_deadline: e.newDeadline,
    what_changed: e.whatChanged, progress_so_far: e.progressSoFar, plan_to_hold: e.planToHold,
    created_at: e.at, workspace_id: ws(),
  }).then(throwIfError);
}

/* -------------------------------- projects ----------------------------------- */
export async function insertProject(p) {
  const now = nowIso();
  await supabase.from("projects").insert({
    id: p.id, company_id: p.companyId, name: p.name, type: p.type,
    baseline_percent: p.baseline, deadline: p.deadline || null,
    locked_at: p.locked ? now : null, status: p.status ?? "active", sort_order: p.sortOrder ?? null,
    workspace_id: ws(), updated_at: now, created_at: now, device_id: getDeviceId(),
  }).then(throwIfError);
}
export async function updateProject(p) {
  await supabase.from("projects").update({
    name: p.name, type: p.type, baseline_percent: p.baseline, deadline: p.deadline || null,
    locked_at: p.locked ? nowIso() : null, status: p.status ?? "active",
    updated_at: nowIso(), device_id: getDeviceId(),
  }).eq("id", p.id).then(throwIfError);
}
export async function softDeleteProject(id) {
  await supabase.from("projects").update({ deleted_at: nowIso(), updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
}
/* Drag-reorder — its own call, same shape as updateTaskQueueOrder below,
 * so a reorder never round-trips the rest of the project's fields. */
export async function updateProjectOrder(id, sortOrder) {
  await supabase.from("projects").update({ sort_order: sortOrder, updated_at: nowIso(), device_id: getDeviceId() })
    .eq("id", id).then(throwIfError);
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

/* ------------------------- task notes & comments (v16) ----------------------
 * Fetched per-project, on demand, when that project's screen opens — unlike
 * reflections/deadline_extensions above, these aren't needed for the
 * dashboard-wide engine state, so there's no reason to pull every project's
 * notes into the initial bootstrap load. */
const rowToTaskNote = (r) => ({
  id: r.id, projectId: r.project_id, taskId: r.task_id ?? null, authorId: r.author_id,
  body: r.body ?? "", photoPath: r.photo_path ?? null, at: r.created_at,
});
export async function fetchTaskNotes(projectId) {
  const rows = await inWorkspace(supabase.from("task_notes").select("*").eq("project_id", projectId))
    .order("created_at", { ascending: false }).then(throwIfError);
  return rows.map(rowToTaskNote);
}
export async function insertTaskNote(n) {
  const { data, error } = await supabase.from("task_notes").insert({
    id: n.id, project_id: n.projectId, task_id: n.taskId || null,
    body: n.body || "", photo_path: n.photoPath || null,
    workspace_id: ws(), created_at: n.at,
  }).select().single();
  if (error) throw new Error(error.message);
  return rowToTaskNote(data);
}
/* Mirrors uploadTaskCompletionPhoto's path convention against the separate
 * 'task-notes' bucket (schema_v16.sql). */
export async function uploadTaskNotePhoto(projectId, file) {
  const workspaceId = ws();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${workspaceId}/${projectId}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from("task-notes")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
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
export async function signMediaUrls(paths, expiresIn = 3600, bucket = "post-media") {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn);
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
