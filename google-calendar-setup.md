# Google Calendar setup for Puroductive

Everything below happens in **your** Google Cloud account — this is the one part of this whole project I genuinely cannot do for you. It takes about 10–15 minutes. Once you're done, come back with the two items marked ✅ **send back to Claude** and I'll build the sync on top of them.

Your redirect URI is already fixed and known — you'll need to paste it in during setup:

```
https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/google-oauth-callback
```

---

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Top left, click the project dropdown → **New Project**
3. Name it `Puroductive` → **Create**
4. Make sure the new project is selected in that same dropdown before continuing

## 2. Enable the Calendar API

1. Left sidebar (or search bar) → **APIs & Services** → **Library**
2. Search **Google Calendar API**
3. Click it → **Enable**

## 3. Configure the OAuth consent screen

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External** (unless you're on Google Workspace and want Internal — External is the standard choice for a personal Gmail account)
3. Fill in:
   - App name: `Puroductive`
   - User support email: your email
   - Developer contact email: your email
4. **Scopes** step — click **Add or Remove Scopes**, search for and add:
   - `.../auth/calendar.events` (create, read, update, delete events — nothing broader)
5. **Test users** step — add your own Google account email here. While the app stays in "Testing" mode (the default, and fine for this — no Google review needed), only accounts listed here can actually authorize it.
6. Save through to the summary and finish. It's fine that it says "Testing" / "unverified" — that's expected and not a problem for personal use.

## 4. Create the OAuth Client ID

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: `Puroductive web`
4. **Authorized redirect URIs** → **Add URI** → paste exactly:
   ```
   https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/google-oauth-callback
   ```
5. **Create**

A dialog shows your **Client ID** and **Client Secret**. Keep this dialog open (or download the JSON) — you need both in the next step.

## 5. Store the credentials

**Client Secret** — set this directly in Supabase yourself; don't paste it into this chat. I have no tool that can set secrets, and it shouldn't pass through an AI conversation regardless.

1. [Supabase Dashboard](https://supabase.com/dashboard/project/pdmhggkiamgodaqhdddd) → **Project Settings** → **Edge Functions** → **Secrets** (or **Functions** → **Secrets**, Supabase has moved this around a bit across versions — search "secrets" in the dashboard if you don't see it immediately)
2. Add two secrets:
   - `GOOGLE_CLIENT_ID` = the Client ID from step 4
   - `GOOGLE_CLIENT_SECRET` = the Client Secret from step 4

## What to send back

✅ **Confirm** you've added both secrets in the Supabase dashboard (just tell me "done" — I don't need to see the values)
✅ **Paste the Client ID here in chat** (this one's fine to share — it's not secret, Google's own docs call it public-safe; I need it to build the "Connect Google Calendar" button's authorization URL)

Once I have that, I'll build:
- The OAuth start/callback Edge Functions
- A `google_calendar_connections` table (your refresh token, RLS-protected, visible only to you)
- The two-way sync itself (push Puroductive events to Google, pull Google's changes back) — running while the app is open, on the same polling pattern already used for chat and notifications
