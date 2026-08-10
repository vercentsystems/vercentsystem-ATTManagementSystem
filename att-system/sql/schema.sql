-- ============================================================================
-- Authority to Travel Management System — Supabase Schema (MVP)
-- Run this whole file once in the Supabase SQL Editor (Project > SQL Editor).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. DIVISIONS
-- ---------------------------------------------------------------------------
create table if not exists divisions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  status        text not null default 'active' check (status in ('active','inactive')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. EMPLOYEES (profile row for every logged-in user; id = auth.users.id)
--    role: 'employee' | 'approver' | 'admin'
--    An approver is still a normal employee row; their approval assignments
--    live in the `approvers` table so approvers are data-driven, not code.
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id                uuid primary key references auth.users(id) on delete cascade,
  employee_no       text unique,
  full_name         text not null,
  position          text not null default '',
  division_id       uuid references divisions(id),
  official_station  text not null default '',
  email             text not null,
  role              text not null default 'employee' check (role in ('employee','approver','admin')),
  status            text not null default 'active' check (status in ('active','inactive')),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. REQUEST TYPES (e.g. Local Travel, Foreign Travel, Seminar/Training)
-- ---------------------------------------------------------------------------
create table if not exists request_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. APPROVAL LEVELS (defines how many sequential levels a division /
--    request type combination requires, e.g. Level 1 = Division Chief,
--    Level 2 = Regional Director)
-- ---------------------------------------------------------------------------
create table if not exists approval_levels (
  id                uuid primary key default gen_random_uuid(),
  division_id       uuid not null references divisions(id),
  request_type_id   uuid references request_types(id), -- null = applies to all types
  level_no          int not null check (level_no > 0),
  label             text not null,                       -- e.g. "Division Chief"
  status            text not null default 'active' check (status in ('active','inactive')),
  effective_date    date not null default current_date,
  created_at        timestamptz not null default now(),
  unique (division_id, request_type_id, level_no)
);

-- ---------------------------------------------------------------------------
-- 5. APPROVERS (assigns a person to a division/request-type/level, with
--    their maintained e-signature). Fully admin-configurable — never
--    hard-coded in application logic.
-- ---------------------------------------------------------------------------
create table if not exists approvers (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  division_id       uuid not null references divisions(id),
  request_type_id   uuid references request_types(id),   -- null = all types
  level_no          int not null check (level_no > 0),
  position_title    text not null default '',             -- as printed on the report
  signature_url     text,                                  -- current signature (Storage path)
  status            text not null default 'active' check (status in ('active','inactive')),
  effective_date    date not null default current_date,
  created_at        timestamptz not null default now()
);

create index if not exists idx_approvers_lookup
  on approvers (division_id, level_no, status);

-- ---------------------------------------------------------------------------
-- 6. TRAVEL ORDERS (the Authority to Travel requests)
-- ---------------------------------------------------------------------------
create table if not exists travel_orders (
  id                  uuid primary key default gen_random_uuid(),
  control_no          text unique,                         -- assigned on submit
  employee_id         uuid not null references employees(id),
  division_id         uuid not null references divisions(id),
  request_type_id     uuid references request_types(id),

  filing_date         date not null default current_date,
  position            text not null,
  official_station    text not null,
  destination         text not null,
  travel_date_from    date not null,
  travel_date_to      date not null,
  purpose             text not null,
  activity_sponsor    text not null default '',

  -- companions travelling on the same authority (mirrors the extra blank
  -- Name / Position / Signature rows on the official form)
  -- shape: [{name, position}]
  companions          jsonb not null default '[]',

  -- "Travel is on:" checkbox
  travel_on           text not null default 'official_business'
                        check (travel_on in ('official_business','official_time')),

  -- "Legal basis:" checkboxes — shape:
  -- {deped_memo:bool, deped_advisory:bool, invitation_letter:bool, others:bool, others_text:text}
  legal_basis         jsonb not null default '{}',

  -- "Expenses covered:" free-text field, exactly as on the official form
  expenses_covered    text not null default '',

  -- "Fund source:" checkboxes — shape:
  -- {local_funds:bool, sub_aro:bool, sub_aro_no:text, hrtd:bool, others:bool, others_text:text}
  fund_source         jsonb not null default '{}',

  -- "Check/Tick if applicable:" checkboxes
  with_government_vehicle boolean not null default false,
  with_registration_fee   boolean not null default false,

  status               text not null default 'draft'
                        check (status in ('draft','submitted','pending','returned','approved','rejected','cancelled')),
  current_level        int not null default 0,
  max_level             int not null default 1,

  submitted_at         timestamptz,
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_travel_orders_employee on travel_orders(employee_id);
create index if not exists idx_travel_orders_status on travel_orders(status);
create index if not exists idx_travel_orders_division on travel_orders(division_id);

-- ---------------------------------------------------------------------------
-- 7. APPROVAL HISTORY (immutable trail; signature is snapshotted so past
--    approvals never change even if the approver updates their signature)
-- ---------------------------------------------------------------------------
create table if not exists approval_history (
  id                    uuid primary key default gen_random_uuid(),
  travel_order_id       uuid not null references travel_orders(id) on delete cascade,
  approver_id           uuid not null references approvers(id),
  level_no              int not null,
  action                text not null check (action in ('approved','rejected','returned','submitted')),
  remarks               text not null default '',
  approver_name_snapshot     text not null,
  approver_position_snapshot text not null,
  signature_snapshot_url     text,             -- copied at time of action
  action_date           timestamptz not null default now()
);

create index if not exists idx_approval_history_order on approval_history(travel_order_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_travel_orders_updated on travel_orders;
create trigger trg_travel_orders_updated before update on travel_orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- control number generator: ATT-YYYY-00001
-- ---------------------------------------------------------------------------
create sequence if not exists travel_order_control_seq;

create or replace function next_control_no() returns text as $$
declare n int;
begin
  n := nextval('travel_order_control_seq');
  return 'ATT-' || to_char(current_date,'YYYY') || '-' || lpad(n::text,5,'0');
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- helper: current user's role / employee row (used in RLS policies)
-- ---------------------------------------------------------------------------
create or replace function current_role_name() returns text as $$
  select role from employees where id = auth.uid();
$$ language sql stable;

create or replace function current_division_id() returns uuid as $$
  select division_id from employees where id = auth.uid();
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table divisions enable row level security;
alter table employees enable row level security;
alter table request_types enable row level security;
alter table approval_levels enable row level security;
alter table approvers enable row level security;
alter table travel_orders enable row level security;
alter table approval_history enable row level security;

-- Reference data: any authenticated user can read; only admins write.
create policy "read divisions" on divisions for select using (auth.uid() is not null);
create policy "admin write divisions" on divisions for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "read request_types" on request_types for select using (auth.uid() is not null);
create policy "admin write request_types" on request_types for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "read approval_levels" on approval_levels for select using (auth.uid() is not null);
create policy "admin write approval_levels" on approval_levels for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "read approvers" on approvers for select using (auth.uid() is not null);
create policy "admin write approvers" on approvers for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

-- Employees: everyone can read basic directory info; users manage their own row; admin manages all.
create policy "read employees" on employees for select using (auth.uid() is not null);
create policy "self update employees" on employees for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manage employees" on employees for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');
create policy "self insert employees" on employees for insert with check (id = auth.uid());

-- Travel orders: owner can CRUD their own drafts; owner can read all their own requests;
-- approvers can read/update requests currently awaiting their level in their division;
-- admins can read/manage everything.
create policy "employee read own orders" on travel_orders for select
  using (employee_id = auth.uid());

create policy "employee insert own orders" on travel_orders for insert
  with check (employee_id = auth.uid());

create policy "employee update own draft" on travel_orders for update
  using (employee_id = auth.uid() and status in ('draft','returned'))
  with check (employee_id = auth.uid());

create policy "approver read assigned orders" on travel_orders for select
  using (
    status in ('submitted','pending') and
    exists (
      select 1 from approvers a
      where a.employee_id = auth.uid()
        and a.status = 'active'
        and a.division_id = travel_orders.division_id
        and a.level_no = travel_orders.current_level
        and (a.request_type_id is null or a.request_type_id = travel_orders.request_type_id)
    )
  );

create policy "approver update assigned orders" on travel_orders for update
  using (
    status in ('submitted','pending') and
    exists (
      select 1 from approvers a
      where a.employee_id = auth.uid()
        and a.status = 'active'
        and a.division_id = travel_orders.division_id
        and a.level_no = travel_orders.current_level
        and (a.request_type_id is null or a.request_type_id = travel_orders.request_type_id)
    )
  );

create policy "admin manage orders" on travel_orders for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

-- Approval history: visible to the order's owner, any approver, and admin. Insert by owner/approver via app logic.
create policy "read approval_history" on approval_history for select
  using (
    exists (select 1 from travel_orders t where t.id = travel_order_id and t.employee_id = auth.uid())
    or current_role_name() in ('approver','admin')
  );

create policy "insert approval_history" on approval_history for insert
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- STORAGE: e-signature bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('signatures','signatures', true)
on conflict (id) do nothing;

create policy "public read signatures" on storage.objects for select
  using (bucket_id = 'signatures');

create policy "admin write signatures" on storage.objects for insert
  with check (bucket_id = 'signatures' and current_role_name() = 'admin');

create policy "admin update signatures" on storage.objects for update
  using (bucket_id = 'signatures' and current_role_name() = 'admin');

create policy "admin delete signatures" on storage.objects for delete
  using (bucket_id = 'signatures' and current_role_name() = 'admin');

-- ---------------------------------------------------------------------------
-- Seed a little reference data (safe to skip/edit)
-- ---------------------------------------------------------------------------
insert into request_types (code, name) values
  ('LOCAL','Local Travel'),
  ('FOREIGN','Foreign Travel'),
  ('SEMINAR','Seminar / Training')
on conflict (code) do nothing;

-- NOTE: Create your first admin manually after signing up:
--   1. Sign up a user via the app login page (or Supabase Auth dashboard).
--   2. update employees set role = 'admin' where email = 'you@agency.gov';
