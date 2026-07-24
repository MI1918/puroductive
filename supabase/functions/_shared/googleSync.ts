// Puroductive — shared Google Calendar pull/push logic.
//
// Factored out of google-calendar-sync/index.ts so the same sync body can
// run two ways: on the CALLER's own JWT-scoped client (manual "Sync now",
// RLS does the authorization) and on the SERVICE ROLE client (the
// google-calendar-cron scheduled job, which has no caller and no JWT — see
// schema_v11.sql for why that's safe: the cron job is the only thing that
// can reach that function at all).
//
// SCOPE — unchanged from the original: pull is full two-way for single and
// recurring events (Google expands recurrence itself via singleEvents=true);
// push only creates NEW events (no google_event_id yet), it does not
// re-push edits to an already-linked event.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type GoogleConnectionRow = {
  id: string;
  workspace_id: string;
  refresh_token: string;
  calendar_id: string;
  sync_token: string | null;
};

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? "Failed to refresh Google access token");
  return data.access_token as string;
}

/* Google's start/end come as either {date: 'YYYY-MM-DD'} (all-day) or
 * {dateTime: ISO, timeZone}. Puroductive's calendar_events store a bare
 * date plus optional HH:MM start/end — no timezone field at all, so a
 * timed event's clock time is taken as-is. */
function fromGoogleTime(t: { date?: string; dateTime?: string }) {
  if (t.date) return { date: t.date, time: null };
  if (t.dateTime) {
    const d = new Date(t.dateTime);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }
  return { date: null, time: null };
}

export async function syncGoogleConnection(
  db: SupabaseClient,
  conn: GoogleConnectionRow,
  googleClientId: string,
  googleClientSecret: string,
) {
  const workspaceId = conn.workspace_id;
  const accessToken = await refreshAccessToken(conn.refresh_token, googleClientId, googleClientSecret);

  // ---------------------------------- PULL ----------------------------------
  let pulled = 0, deleted = 0;
  let syncToken = conn.sync_token;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  const baseParams: Record<string, string> = { singleEvents: "true", maxResults: "250" };
  if (syncToken) {
    baseParams.syncToken = syncToken;
  } else {
    const now = new Date();
    const future = new Date(Date.now() + 90 * 864e5);
    baseParams.timeMin = now.toISOString();
    baseParams.timeMax = future.toISOString();
  }

  do {
    const listUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`);
    for (const [k, v] of Object.entries(baseParams)) listUrl.searchParams.set(k, v);
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (listRes.status === 410) {
      // Sync token expired/invalid on Google's side — drop it; the next run
      // does a fresh full sync.
      await db.from("google_calendar_connections").update({ sync_token: null, updated_at: new Date().toISOString() }).eq("id", conn.id);
      return { pulled: 0, deleted: 0, pushed: 0, note: "sync token expired — will do a fresh full sync next time" };
    }
    const list = await listRes.json();
    if (!listRes.ok) throw new Error(list.error?.message ?? "Google Calendar list request failed");

    for (const ev of list.items ?? []) {
      if (ev.status === "cancelled") {
        const { error } = await db.from("calendar_events")
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId).eq("google_event_id", ev.id).is("deleted_at", null);
        if (!error) deleted++;
        continue;
      }
      const start = fromGoogleTime(ev.start ?? {});
      if (!start.date) continue;
      const end = fromGoogleTime(ev.end ?? {});
      const now = new Date().toISOString();
      const { error } = await db.from("calendar_events").upsert({
        id: `gev-${ev.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60),
        workspace_id: workspaceId, google_event_id: ev.id,
        title: ev.summary || "(untitled)", event_type: "other",
        event_date: start.date, start_time: start.time, end_time: end.time,
        location: ev.location || null, notes: ev.description || null,
        attendee_ids_json: "[]", updated_at: now, created_at: now, device_id: "google-sync",
      }, { onConflict: "workspace_id,google_event_id" });
      if (!error) pulled++;
    }

    pageToken = list.nextPageToken ?? null;
    if (list.nextSyncToken) nextSyncToken = list.nextSyncToken;
  } while (pageToken);

  // ---------------------------------- PUSH ----------------------------------
  let pushed = 0;
  const { data: unpushed } = await db.from("calendar_events")
    .select("*").eq("workspace_id", workspaceId).is("google_event_id", null).is("deleted_at", null).limit(50);

  for (const localEv of unpushed ?? []) {
    const body: Record<string, unknown> = {
      summary: localEv.title,
      location: localEv.location || undefined,
      description: localEv.notes || undefined,
    };
    if (localEv.start_time) {
      body.start = { dateTime: `${localEv.event_date}T${localEv.start_time}:00` };
      body.end = { dateTime: `${localEv.event_date}T${localEv.end_time || localEv.start_time}:00` };
    } else {
      body.start = { date: localEv.event_date };
      const endDate = new Date(localEv.event_date + "T00:00:00");
      endDate.setDate(endDate.getDate() + 1);
      body.end = { date: endDate.toISOString().slice(0, 10) };
    }

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    const created = await createRes.json();
    if (createRes.ok) {
      await db.from("calendar_events").update({ google_event_id: created.id, updated_at: new Date().toISOString() }).eq("id", localEv.id);
      pushed++;
    }
  }

  await db.from("google_calendar_connections").update({
    sync_token: nextSyncToken ?? syncToken, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", conn.id);

  return { pulled, deleted, pushed };
}
