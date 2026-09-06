/**
 * The API, as a Netlify function.
 *
 * The same Express app the local server runs. It is imported, not re-implemented, so there is
 * one set of endpoints and one query parser rather than two that drift.
 *
 * WHAT THIS COSTS, because it is not free. The app's whole design premise is that the flow
 * table lives in memory as typed arrays, so a filter change is one linear scan of 409,785
 * rows instead of a re-query. A function container keeps that table between invocations, so
 * warm requests behave exactly like the local server. A COLD container has to read and parse
 * 12MB of JSON and build the typed arrays first, which is around 130ms locally and more on a
 * smaller machine. That is the price of running a stateful design on a stateless platform,
 * and it is paid on the first request after a container is recycled, not on every request.
 *
 * The import is deliberately at module scope, not inside the handler: that is what puts the
 * parse in the container's init phase and lets every later invocation reuse it.
 */

import serverless from 'serverless-http';
import { app } from '../../server/index.mjs';

const wrapped = serverless(app, {
  // 80MB of poster PNG has nowhere to go here; the save endpoint is off in production
  // anyway. Keeping the cap low means a malformed request fails fast rather than
  // buffering into the function's memory.
  binary: false,
});

/**
 * Netlify rewrites /api/x to /.netlify/functions/api/x, so Express would see the function's
 * own mount path rather than the route it declares. Put the path back before handing it over.
 */
export const handler = async (event, context) => {
  const p = event.path || '';
  const mount = '/.netlify/functions/api';
  if (p.startsWith(mount)) {
    event.path = '/api' + (p.slice(mount.length) || '');
    if (event.rawUrl) {
      event.rawUrl = event.rawUrl.replace(mount, '/api');
    }
  }
  // Without this the runtime waits for the event loop to drain on every invocation, which
  // costs the full timeout once anything schedules a timer.
  context.callbackWaitsForEmptyEventLoop = false;
  return wrapped(event, context);
};
