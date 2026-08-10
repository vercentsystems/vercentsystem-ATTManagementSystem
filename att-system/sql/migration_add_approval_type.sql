-- ============================================================================
-- MIGRATION: Add explicit Approval Type (Recommending Approval / Approving
-- Authority) to approval_levels and approval_history.
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor if you already ran schema.sql
-- (and possibly migration_division_to_official_station.sql) before this
-- change existed. Safe to run on a live project — purely additive.
--
-- Before this migration, the report guessed which signature box to use
-- (Recommending Approval vs Approved) from level position (level 1 vs the
-- final level). Now it's an explicit, admin-set field on each Approval
-- Level, matching your organization's real roles:
--   Recommending Approval  -> Immediate Supervisor / Department Head
--   Approving Authority    -> Division Head / Director / Executive /
--                             Authorized Official
-- ============================================================================

alter table approval_levels
  add column if not exists approval_type text not null default 'recommending'
  check (approval_type in ('recommending','approving'));

alter table approval_history
  add column if not exists approval_type text not null default 'recommending'
  check (approval_type in ('recommending','approving'));

-- Sensible one-time backfill for existing approval_levels rows: the highest
-- level number per (official_station, request_type) group becomes
-- "approving" (final signoff); everything else stays "recommending".
-- Review these afterward in Admin → Approval Levels — this is just a
-- reasonable starting point, not guaranteed to match your intent everywhere.
with ranked as (
  select id, level_no,
         max(level_no) over (partition by official_station_id, request_type_id) as max_level
  from approval_levels
)
update approval_levels al
set approval_type = case when r.level_no = r.max_level then 'approving' else 'recommending' end
from ranked r
where al.id = r.id;

-- Same backfill logic for existing approval_history rows, using each
-- request's max_level at the time (best-effort; only affects historical
-- display, not routing).
update approval_history ah
set approval_type = case
  when ah.level_no = (select max_level from travel_orders t where t.id = ah.travel_order_id)
  then 'approving' else 'recommending'
end;

-- Done. Go to Admin → Approval Levels and set "Approval Type" explicitly for
-- each row (Recommending Approval vs Approving Authority) rather than
-- relying on this backfill guess.
