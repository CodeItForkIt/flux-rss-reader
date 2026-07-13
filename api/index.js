// Vercel serverless entry point.
// The real Express app lives in ../server/index.js — this file just
// re-exports it so Vercel's function tracer only needs to follow one
// relative require (which correctly pulls in server/store-factory.js,
// server/auth-utils.js, server/db*.js, etc. from their real location).
//
// IMPORTANT: do not paste server/index.js's contents in here directly.
// If you do, its `require('./store-factory')` etc. will resolve against
// api/ instead of server/, and those files don't exist here — you'll get
// "Cannot find module './store-factory'" at runtime on Vercel (but not
// locally, since `node server/index.js` resolves correctly).
module.exports = require('../server/index.js');
