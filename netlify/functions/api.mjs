/**
 * The API, as a Netlify function.
 *
 * The same Express app the local server runs. It is imported, not re-implemented, so there is
 * one set of endpoints and one query parser rather than two that drift.
 *
 * WHY THE IMPORT IS WRAPPED IN A TRY. If a module throws while loading, the container never
 * finishes initialising and the platform answers 502 with an empty body. The reason goes only
 * to the function log, which makes a deploy that cannot find its data look identical to one
 * that ran out of memory or hit a bundler bug. Catching it turns an opaque platform failure
 * into an ordinary 500 carrying the real message, so the page can say what happened without
 * anyone opening a log.
 *
 * WHAT THIS COSTS. The app is fast because the flow table lives in memory as typed arrays and
 * a filter change is one linear scan of 409,785 rows rather than a re-query. A container keeps
 * that between invocations, so warm requests behave like the local server, measured at 1-14ms.
 * A cold container parses 12MB of JSON first, about 130ms locally. The import stays at module
 * scope, top-level await and all, so that parse still happens during container init rather
 * than inside the first request.
 */

import serverless from 'serverless-http';

let wrapped = null;
let initError = null;

try {
  const mod = await import('../../server/index.mjs');
  wrapped = serverless(mod.app, {
    // 80MB of poster PNG has nowhere to go here, and the save endpoint is off in production
    // anyway. A malformed request should fail fast rather than buffer into the function.
    binary: false,
  });
} catch (err) {
  initError = err;
  console.error('Function failed to initialise:', err);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** Never let a diagnostic throw; a failed listing is itself part of the answer. */
function safeList(dir) {
  try {
    return fsSync.readdirSync(dir).slice(0, 40);
  } catch (e) {
    return `unreadable: ${e.message}`;
  }
}

let fsSync;
try { fsSync = (await import('node:fs')).default; } catch { /* reported below */ }

export const handler = async (event, context) => {
  // Without this the runtime waits for the event loop to drain on every invocation, which
  // costs the full timeout once anything schedules a timer.
  context.callbackWaitsForEmptyEventLoop = false;

  if (initError) {
    const cwd = process.cwd();
    return json(500, {
      error: initError.message,
      stack: String(initError.stack || '').split('\n').slice(0, 6),
      // The usual cause of an init failure here is included_files not landing where the
      // lookup expects, so report what the container can actually see. One request, and the
      // real layout is known rather than guessed at.
      cwd,
      moduleDir: new URL('.', import.meta.url).pathname,
      taskContents: safeList(cwd),
      dataContents: safeList(cwd + '/data'),
      processedContents: safeList(cwd + '/data/processed'),
    });
  }

  // Netlify rewrites /api/x to /.netlify/functions/api/x, so Express would see the function's
  // own mount path rather than the route it declares. Put the path back before handing over.
  const p = event.path || '';
  const mount = '/.netlify/functions/api';
  if (p.startsWith(mount)) {
    event.path = '/api' + (p.slice(mount.length) || '');
    if (event.rawUrl) event.rawUrl = event.rawUrl.replace(mount, '/api');
  }
  return wrapped(event, context);
};
