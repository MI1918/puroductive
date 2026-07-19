-- Optional starting data for Puroductive.
--
-- The app has no "add company" or "add team member" screen (it never did —
-- those were hardcoded seed arrays in the original prototype). Run this once
-- in the Supabase SQL editor so Projects/Team aren't empty on first login.
-- Safe to skip, edit, or re-run (each insert is idempotent via ON CONFLICT).
--
-- roles_json packs { roles, phone, email } as JSON text, since team_members
-- has no dedicated phone/email columns — see src/lib/db.js for the mapping.

insert into public.companies (id, name, industry, location, theme_json, device_id, updated_at, created_at)
values
  ('c-jag', 'Shree Jagdamba Hydropneumatic', 'Industrial Manufacturing & Hydropneumatics', 'Nagpur',
   '{"key":"apricot","label":"Apricot","primary":"#D97706","ink":"#4A2A03","mesh":["#FDEED3","#FBD38D","#F6AD55"]}',
   'seed', now()::text, now()::text),
  ('c-f6', 'Form6', 'Nutraceuticals · EU Market', 'Nagpur',
   '{"key":"mint","label":"Sea Mint","primary":"#0E9F6E","ink":"#093826","mesh":["#D9FBEA","#8FE3BE","#4CC694"]}',
   'seed', now()::text, now()::text)
on conflict (id) do nothing;

insert into public.team_members (id, name, roles_json, notes, is_external, is_default_delegate, device_id, updated_at, created_at)
values
  ('m-raj', 'Raj',
   '{"roles":["Delegation","Assembly","Follow-ups"],"phone":"+91 90000 00001","email":"raj@workpool.in"}',
   'Default contact for reassigned or missed tasks.', 0, 1, 'seed', now()::text, now()::text),
  ('m-nir', 'Niranjan',
   '{"roles":["B2B Liaison","Branding & Web"],"phone":"+91 90000 00002","email":"niranjan@nirmal.co"}',
   'Industrial chemical trading · Solar (Nirmal Co.)', 0, 0, 'seed', now()::text, now()::text),
  ('m-pur', 'Puroshotam',
   '{"roles":["CNC Machining","Fabrication"],"phone":"+91 90000 00003","email":"—"}',
   'Prone to floor-urgency delays — strict follow-up tracking.', 0, 0, 'seed', now()::text, now()::text),
  ('m-lsr', 'Laser Cutting Vendor',
   '{"roles":["Laser Cutting"],"phone":"+91 90000 00004","email":"orders@laserworks.in"}',
   'External dependency · frequent Handoff/Retry on missed calls.', 1, 0, 'seed', now()::text, now()::text)
on conflict (id) do nothing;

insert into public.member_company_links (id, member_id, company_id, device_id, updated_at, created_at)
values
  ('l-raj-jag', 'm-raj', 'c-jag', 'seed', now()::text, now()::text),
  ('l-raj-f6',  'm-raj', 'c-f6',  'seed', now()::text, now()::text),
  ('l-nir-jag', 'm-nir', 'c-jag', 'seed', now()::text, now()::text),
  ('l-nir-f6',  'm-nir', 'c-f6',  'seed', now()::text, now()::text),
  ('l-pur-jag', 'm-pur', 'c-jag', 'seed', now()::text, now()::text),
  ('l-lsr-jag', 'm-lsr', 'c-jag', 'seed', now()::text, now()::text)
on conflict (id) do nothing;
