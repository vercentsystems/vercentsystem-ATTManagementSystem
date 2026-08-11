-- ============================================================================
-- MIGRATION: Add supporting-document attachments
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor to add attachment support to an
-- existing project. Safe to run on a live project — purely additive.
--
-- Adds:
--   - travel_order_attachments (metadata table)
--   - a private 'attachments' Storage bucket
--   - RLS on both, mirroring exactly who can already see a given
--     travel_order (owner, currently-assigned approver, admin)
-- ============================================================================

create table if not exists travel_order_attachments (
  id                uuid primary key default gen_random_uuid(),
  travel_order_id   uuid not null references travel_orders(id) on delete cascade,
  file_name         text not null,
  file_path         text not null,
  file_type         text not null default '',
  file_size         bigint not null default 0,
  uploaded_by       uuid not null references employees(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_attachments_order on travel_order_attachments(travel_order_id);

alter table travel_order_attachments enable row level security;

drop policy if exists "read attachments meta" on travel_order_attachments;
create policy "read attachments meta" on travel_order_attachments for select
  using (
    exists (
      select 1 from travel_orders t
      where t.id = travel_order_attachments.travel_order_id
        and (
          t.employee_id = auth.uid()
          or current_role_name() = 'admin'
          or exists (
            select 1 from approvers a
            where a.employee_id = auth.uid()
              and a.status = 'active'
              and a.official_station_id = t.official_station_id
              and a.level_no = t.current_level
              and (a.request_type_id is null or a.request_type_id = t.request_type_id)
          )
        )
    )
  );

drop policy if exists "insert attachments meta" on travel_order_attachments;
create policy "insert attachments meta" on travel_order_attachments for insert
  with check (
    exists (
      select 1 from travel_orders t
      where t.id = travel_order_attachments.travel_order_id
        and t.employee_id = auth.uid()
        and t.status in ('draft','returned')
    )
  );

drop policy if exists "delete attachments meta" on travel_order_attachments;
create policy "delete attachments meta" on travel_order_attachments for delete
  using (
    exists (
      select 1 from travel_orders t
      where t.id = travel_order_attachments.travel_order_id
        and t.employee_id = auth.uid()
        and t.status in ('draft','returned')
    )
  );

insert into storage.buckets (id, name, public)
values ('attachments','attachments', false)
on conflict (id) do nothing;

create or replace function attachment_travel_order_id(object_name text) returns uuid as $$
  select nullif((string_to_array(object_name, '/'))[1], '')::uuid;
$$ language sql immutable;

drop policy if exists "read attachments" on storage.objects;
create policy "read attachments" on storage.objects for select
  using (
    bucket_id = 'attachments' and
    exists (
      select 1 from travel_orders t
      where t.id = attachment_travel_order_id(storage.objects.name)
        and (
          t.employee_id = auth.uid()
          or current_role_name() = 'admin'
          or exists (
            select 1 from approvers a
            where a.employee_id = auth.uid()
              and a.status = 'active'
              and a.official_station_id = t.official_station_id
              and a.level_no = t.current_level
              and (a.request_type_id is null or a.request_type_id = t.request_type_id)
          )
        )
    )
  );

drop policy if exists "insert attachments" on storage.objects;
create policy "insert attachments" on storage.objects for insert
  with check (
    bucket_id = 'attachments' and
    exists (
      select 1 from travel_orders t
      where t.id = attachment_travel_order_id(storage.objects.name)
        and t.employee_id = auth.uid()
        and t.status in ('draft','returned')
    )
  );

drop policy if exists "delete attachments" on storage.objects;
create policy "delete attachments" on storage.objects for delete
  using (
    bucket_id = 'attachments' and
    exists (
      select 1 from travel_orders t
      where t.id = attachment_travel_order_id(storage.objects.name)
        and t.employee_id = auth.uid()
        and t.status in ('draft','returned')
    )
  );

NOTIFY pgrst, 'reload schema';
