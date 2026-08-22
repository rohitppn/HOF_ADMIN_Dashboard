-- HOF ops bot — Supabase (Postgres) schema
-- Mirrors src/db.js (better-sqlite3) 1:1 so backfill is a straight copy.
-- Paste the whole file into Supabase → SQL Editor → New Query → Run.

create table if not exists opening_balance (
  id           bigserial primary key,
  store_key    text      not null,
  date         text      not null,
  amount       integer   not null,
  reported_at  text      not null,
  raw_text     text,
  unique (store_key, date)
);

create table if not exists store_open (
  id           bigserial primary key,
  store_key    text      not null,
  date         text      not null,
  opened_at    text      not null,
  late         smallint  not null default 0,
  raw_text     text,
  unique (store_key, date)
);

create table if not exists hourly_sales (
  id           bigserial primary key,
  store_key    text      not null,
  date         text      not null,
  slot         text      not null,
  sales        integer   not null,
  bills        integer,
  walkins      integer,
  reported_at  text      not null,
  raw_text     text,
  unique (store_key, date, slot)
);

create table if not exists big_bills (
  id           bigserial primary key,
  store_key    text      not null,
  date         text      not null,
  amount       integer   not null,
  reported_at  text      not null,
  raw_text     text
);

create table if not exists grooming (
  id           bigserial primary key,
  store_key    text      not null,
  date         text      not null,
  compliant    smallint  not null,
  notes        text,
  reported_at  text      not null,
  raw_text     text,
  unique (store_key, date)
);

create table if not exists dsr (
  id            bigserial primary key,
  store_key     text      not null,
  date          text      not null,
  total_sales   integer   not null,
  total_bills   integer,
  walkins       integer,
  conversion    numeric(6,2),
  reported_at   text      not null,
  raw_text      text,
  unique (store_key, date)
);

create table if not exists message_log (
  id           bigserial primary key,
  jid          text      not null,
  sender       text,
  is_group     smallint  not null,
  text         text,
  intent       text,
  parsed_json  jsonb,
  received_at  text      not null
);

-- Indexes for dashboard filters (date-range queries dominate).
create index if not exists idx_hourly_date       on hourly_sales (date);
create index if not exists idx_hourly_store_date on hourly_sales (store_key, date);
create index if not exists idx_dsr_date          on dsr (date);
create index if not exists idx_dsr_store_date    on dsr (store_key, date);
create index if not exists idx_bigbills_date     on big_bills (date);
create index if not exists idx_open_date         on store_open (date);
create index if not exists idx_groom_date        on grooming (date);
create index if not exists idx_msglog_received   on message_log (received_at desc);
create index if not exists idx_msglog_intent     on message_log (intent);

-- Row-Level Security — turn ON so the anon key cannot read anything.
-- The service_role key bypasses RLS, so the bot and dashboard server continue to work.
alter table opening_balance enable row level security;
alter table store_open      enable row level security;
alter table hourly_sales    enable row level security;
alter table big_bills       enable row level security;
alter table grooming        enable row level security;
alter table dsr             enable row level security;
alter table message_log     enable row level security;
