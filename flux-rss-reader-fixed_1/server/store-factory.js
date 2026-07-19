'use strict';
/**
 * server/store-factory.js
 *
 * Picks which data store implementation to use: Supabase (Postgres) when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set — the right choice for
 * Vercel or any other host without a persistent local filesystem — or the
 * local JSON file store otherwise (the original self-hosted/Electron model).
 */
const { JSONStore } = require('./db');

function createStore(dbPath) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[db] Using Supabase for storage.');
    const { SupabaseStore } = require('./db-supabase'); // lazy — local-only setups shouldn't need this module resolvable at all
    return new SupabaseStore();
  }
  console.log(`[db] Using local JSON file storage at ${dbPath}`);
  return new JSONStore(dbPath);
}

module.exports = { createStore };
