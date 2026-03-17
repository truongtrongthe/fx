-- Run this in Supabase SQL Editor to create the limit_plans table and RLS.
-- Table: limit_plans (saved limit orders per device_id).

create table if not exists limit_plans (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  tf text not null,
  direction text not null,
  limit_price numeric not null,
  tp1 numeric,
  tp2 numeric,
  sl numeric,
  created_at timestamptz default now() not null,
  status text not null default 'active' check (status in ('active', 'filled', 'cancelled'))
);

alter table limit_plans enable row level security;

-- Allow anon to CRUD; app filters by device_id on every query.
create policy "Allow anon CRUD limit_plans"
  on limit_plans for all to anon
  using (true)
  with check (true);
