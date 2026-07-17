-- Flux — Supabase schema
--
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL
-- Editor → New query → paste → Run) before pointing Flux at it.
--
-- These tables are accessed exclusively through the service_role key from
-- Flux's own server code (never directly from a browser), so Row Level
-- Security is left disabled — the service_role key bypasses RLS anyway,
-- and Flux's own auth layer (bcrypt + session tokens) is what actually
-- gates access. Do NOT expose the service_role key to any client-side code.

create table if not exists users (
  id                          bigint generated always as identity primary key,
  username                    text unique not null,
  password                    text not null,               -- bcrypt hash
  is_admin                    boolean not null default false,
  email                       text,
  two_factor_secret           text,                          -- encrypted at rest (AES-256-GCM, see server/crypto-util.js)
  two_factor_enabled          boolean not null default false,
  pending_two_factor_secret   text,                          -- encrypted at rest
  created_at                  timestamptz not null default now()
);
create unique index if not exists users_email_lower_idx on users (lower(email)) where email is not null;

create table if not exists sessions (
  token_hash    text primary key,      -- SHA-256 of the device token — the raw token is never stored
  user_id       bigint not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  label         text
);
create index if not exists sessions_user_id_idx on sessions (user_id);

create table if not exists folders (
  id        text primary key,
  user_id   bigint not null references users(id) on delete cascade,
  name      text not null,
  icon      text default '◈',
  "order"   integer default 0,
  thumbnail_mode text,
  -- Folder-level defaults for feeds in this folder that don't set their
  -- own override (same precedence pattern as thumbnail_mode above: feed's
  -- own value wins if set, else the folder's, else the global setting).
  -- Deliberately excludes anything feed-identity/site-specific (name, url,
  -- cssSelectors, htmlPatterns, favicon) — those don't make sense shared
  -- across unrelated sites just because they're filed in the same folder.
  hide_shorts           boolean,
  inline_browser        boolean,
  title_blocklist       jsonb default '[]',
  prefer_feed_content   boolean,
  fetch_strategy_order  jsonb default '[]'
);
create index if not exists folders_user_id_idx on folders (user_id);

create table if not exists feeds (
  id                     text primary key,
  user_id                bigint not null references users(id) on delete cascade,
  name                   text,
  url                    text not null,
  folder                 text,
  is_youtube             boolean default false,
  inline_browser         boolean default false,
  hide_shorts            boolean default false,
  css_selectors          jsonb default '[]',
  html_patterns          jsonb default '[]',
  favicon                text,
  title_blocklist        jsonb default '[]',
  fetch_strategy_order   jsonb default '[]',
  show_thumbnail         boolean,
  thumbnail_mode         text,
  prefer_feed_content    boolean
);
create index if not exists feeds_user_id_idx on feeds (user_id);

create table if not exists article_state (
  key         text not null,
  user_id     bigint not null references users(id) on delete cascade,
  is_read     boolean default false,
  is_starred  boolean default false,
  primary key (key, user_id)
);
create index if not exists article_state_user_id_idx on article_state (user_id);

create table if not exists user_settings (
  user_id  bigint primary key references users(id) on delete cascade,
  data     jsonb not null default '{}'
);

-- Singleton row (id is always true) — admin-controlled instance-wide settings.
create table if not exists system_settings (
  id    boolean primary key default true,
  data  jsonb not null default '{}',
  constraint system_settings_singleton check (id = true)
);

-- Article content cache — keyed by article URL. TTL/expiry is enforced in
-- application code (server/index.js reads articleCacheDays from settings),
-- not here; old rows are simply overwritten or ignored once stale.
create table if not exists article_cache (
  url       text primary key,
  feed_id   text,
  ts        bigint not null,
  result    jsonb not null
);
-- These back two filtered deletes in server/db-supabase.js
-- (cacheDeleteByFeedId, cachePruneExpired) that intentionally never read
-- the `result` column — without an index on feed_id/ts, Postgres has no
-- way to satisfy either WHERE clause without visiting every row anyway,
-- including the (potentially large — full article HTML) result column.
create index if not exists article_cache_feed_id_idx on article_cache (feed_id);
create index if not exists article_cache_ts_idx on article_cache (ts);

-- Error log — persists both server-side (unhandled route errors) and
-- client-side (window.onerror/unhandledrejection, and caught-but-reported
-- UI errors) failures. Exists because Vercel's own function logs already
-- show these (see the global error-handling middleware in server/index.js),
-- but only for a short retention window and only for server-side errors —
-- a client-side failure (a fetch that rejects inside a React event handler,
-- for instance) never reaches Vercel's logs at all. Queryable from here
-- indefinitely (well, until the lazy 30-day prune in logError below).
create table if not exists error_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  source      text not null,   -- 'server' | 'client'
  user_id     bigint references users(id) on delete set null,
  path        text,
  message     text,
  stack       text,
  context     jsonb
);
create index if not exists error_logs_created_at_idx on error_logs (created_at desc);
