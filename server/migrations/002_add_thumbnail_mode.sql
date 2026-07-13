-- Adds the per-feed lead-image *mode* override column (feed settings →
-- "Lead image in article list": large / small / none / inherit global).
-- Supersedes the old show_thumbnail boolean column added in migration 001
-- (harmless to leave in place — it's just no longer read).
--
-- Run this once in the Supabase SQL editor (or via `psql`) against your
-- existing database:

alter table feeds add column if not exists thumbnail_mode text;
