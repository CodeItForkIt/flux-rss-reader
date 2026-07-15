-- Adds per-folder lead-image mode override (folder settings -> Lead image
-- in article list: large / small / none / inherit global), mirroring the
-- per-feed thumbnail_mode column added in migration 002.
--
-- Run this once in the Supabase SQL editor (or via `psql`) against your
-- existing database:

alter table folders add column if not exists thumbnail_mode text;
