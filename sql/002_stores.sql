-- Stores are managed from the dashboard, not from src/config.js.
-- Paste this into Supabase → SQL Editor → Run.
-- The bot seeds the table with the current 11 stores on first boot (if empty).

create table if not exists stores (
  key            text primary key,
  name           text not null,
  phone          text not null,
  daily_target   integer not null default 100000,
  hourly_target  integer not null default 12000,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists uq_stores_phone on stores (phone);
create index if not exists idx_stores_active on stores (active);

alter table stores enable row level security;
