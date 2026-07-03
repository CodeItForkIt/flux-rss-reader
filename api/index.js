'use strict';
/**
 * api/index.js — Vercel serverless entry point.
 *
 * Vercel automatically treats any file under /api as a serverless function.
 * This one just re-exports the same Express app used everywhere else —
 * server/index.js already detects process.env.VERCEL (auto-set by the
 * platform) and skips calling app.listen() in that case, since Vercel's
 * runtime handles binding/listening itself and invokes the exported app
 * per-request instead.
 *
 * vercel.json (project root) routes all requests here.
 */
module.exports = require('../server/index.js');
