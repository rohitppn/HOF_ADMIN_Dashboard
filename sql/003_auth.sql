-- Dashboard login users. Paste into Supabase → SQL Editor → Run.
-- The server bootstraps a first admin from ADMIN_EMAIL/ADMIN_PASSWORD env vars
-- on boot if this table is empty.

create table if not exists admin_users (
  email          text primary key,
  password_hash  text not null,
  salt           text not null,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

alter table admin_users enable row level security;
