-- ============================================================================
-- MIGRATION: Align travel_orders with the official "Authority to Travel" /
-- "Travel Authority for Official Travel" form fields.
-- ============================================================================
-- Run this ONCE if your `travel_orders` table was created before the
-- request form was redesigned to match the official DepEd form (Legal
-- Basis checkboxes, Fund Source checkboxes, Expenses Covered free text,
-- Travel Is On, Government Vehicle / Registration Fee, Companions).
--
-- Symptom this fixes: fields like Fund Source appearing blank or wrong on
-- the printed report, or "Save failed: Could not find the '...' column"
-- errors when filing/editing a request — both mean your live table still
-- has the OLDER column shapes this migration replaces.
--
-- Safe to run more than once. If you're setting up a brand-new project,
-- don't run this — sql/schema.sql already creates the table in this shape.
-- ============================================================================

-- Drop legacy columns from the pre-redesign schema (safe no-ops if you
-- already have the new shape, or never had these).
alter table travel_orders drop column if exists total_expenses;   -- generated column depended on the old `expenses` array
alter table travel_orders drop column if exists travel_classification;
alter table travel_orders drop column if exists expenses;
alter table travel_orders drop column if exists transportation;

-- fund_source and legal_basis are now JSONB (checkbox data), not TEXT.
-- Drop and recreate as JSONB — this resets any existing free-text values
-- in these two columns, since the old free-text shape isn't compatible
-- with the new checkbox-based shape anyway.
alter table travel_orders drop column if exists fund_source;
alter table travel_orders drop column if exists legal_basis;
alter table travel_orders add column if not exists fund_source jsonb not null default '{}';
alter table travel_orders add column if not exists legal_basis jsonb not null default '{}';

-- Add the remaining new columns.
alter table travel_orders add column if not exists companions jsonb not null default '[]';
alter table travel_orders add column if not exists travel_on text not null default 'official_business'
  check (travel_on in ('official_business','official_time'));
alter table travel_orders add column if not exists expenses_covered text not null default '';
alter table travel_orders add column if not exists with_government_vehicle boolean not null default false;
alter table travel_orders add column if not exists with_registration_fee boolean not null default false;

-- Force PostgREST to pick up the new columns immediately instead of
-- waiting for its next automatic schema cache refresh.
NOTIFY pgrst, 'reload schema';

-- Done. Any existing draft/pending requests will show blank Fund Source /
-- Legal Basis until edited and re-saved (their old data was reset above);
-- new requests filed from here on will populate these fields correctly.
