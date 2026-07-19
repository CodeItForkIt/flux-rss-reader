-- Adds the per-feed "use this feed's own RSS content instead of
-- live-fetching the linked page" opt-in (feed settings). Replaces the
-- automatic heuristic that used to try to guess this from content length
-- and pattern-matching, which regressed The Verge (and possibly other
-- publishers who write long RSS summaries) twice.
--
-- Run this once in the Supabase SQL editor (or via `psql`) against your
-- existing database:

alter table feeds add column if not exists prefer_feed_content boolean;
