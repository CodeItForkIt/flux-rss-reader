-- Adds the per-feed lead-image override column (feed settings → "Lead
-- image in article list"). Only needed once, on an existing database —
-- fresh installs get this automatically from supabase-schema.sql.
--
-- Run this once in the Supabase SQL editor (or via `psql`) against your
-- existing database:

alter table feeds add column if not exists show_thumbnail boolean;
