// Vercel serverless entry: POST /api/call/:name  (logic lives in src/http/call.ts, built to lib/).
const { handler } = require('../../lib/http/call');

module.exports = handler;
