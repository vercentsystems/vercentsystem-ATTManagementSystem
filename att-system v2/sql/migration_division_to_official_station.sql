-- ============================================================================
-- MIGRATION: Divisions → Official Stations
-- ============================================================================
-- Run this ONCE if you already ran the original sql/schema.sql (the one that
-- used a "divisions" table) and now want approval routing keyed on Official
-- Station instead. If you are setting up a brand-new project, don't run
-- this — just run the updated sql/schema.sql directly.
--
-- This preserves your existing data: divisions become official_stations
-- with the same ids, so every employee/approver/approval_level/travel_order
-- link stays intact — only the names change.
-- ============================================================================

-- 1. Rename the table itself (keeps all existing rows + ids)
alter table divisions rename to official_stations;

-- 2. Rename the foreign key columns on every table that referenced it
alter table employees        rename column division_id to official_station_id;
alter table approval_levels  rename column division_id to official_station_id;
alter table approvers        rename column division_id to official_station_id;
alter table travel_orders    rename column division_id to official_station_id;

-- 3. Drop the old free-text official_station column on employees — it's
--    superseded by the FK (the printed report's Official Station text now
--    comes from official_stations.name via travel_orders.official_station,
--    which is unaffected by this migration).
alter table employees drop column if exists official_station;

-- 4. Rename indexes/functions to match (cosmetic, but keeps things tidy)
alter index if exists idx_travel_orders_division rename to idx_travel_orders_official_station;
drop function if exists current_division_id();
create or replace function current_official_station_id() returns uuid as $$
  select official_station_id from employees where id = auth.uid();
$$ language sql stable;

-- 5. Drop and recreate the RLS policies that referenced the old table/column
--    names (Postgres does not auto-rewrite policy bodies).
drop policy if exists "read divisions" on official_stations;
drop policy if exists "admin write divisions" on official_stations;
create policy "read official_stations" on official_stations for select using (auth.uid() is not null);
create policy "admin write official_stations" on official_stations for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

drop policy if exists "approver read assigned orders" on travel_orders;
create policy "approver read assigned orders" on travel_orders for select
  using (
    status in ('submitted','pending') and
    exists (
      select 1 from approvers a
      where a.employee_id = auth.uid()
        and a.status = 'active'
        and a.official_station_id = travel_orders.official_station_id
        and a.level_no = travel_orders.current_level
        and (a.request_type_id is null or a.request_type_id = travel_orders.request_type_id)
    )
  );

drop policy if exists "approver update assigned orders" on travel_orders;
create policy "approver update assigned orders" on travel_orders for update
  using (
    status in ('submitted','pending') and
    exists (
      select 1 from approvers a
      where a.employee_id = auth.uid()
        and a.status = 'active'
        and a.official_station_id = travel_orders.official_station_id
        and a.level_no = travel_orders.current_level
        and (a.request_type_id is null or a.request_type_id = travel_orders.request_type_id)
    )
  );

-- Done. Every employee's official_station_id is currently whatever their old
-- division_id pointed to — go to Admin → Official Stations and rename those
-- rows to your actual school/office names (e.g. "Banila Elementary School"),
-- then re-check Admin → Approval Levels and Admin → Approvers, since those
-- now route by Official Station.
