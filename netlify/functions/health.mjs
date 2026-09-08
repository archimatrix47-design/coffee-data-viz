/**
 * A canary with no dependencies.
 *
 * The API function answers 502, which means its container dies before anything inside it can
 * report why. That leaves two very different explanations indistinguishable: the app failing
 * (cannot find its data, a bad import) or functions not working at all on this deploy (a
 * bundler problem, a runtime mismatch, a wrong functions directory).
 *
 * This imports nothing and touches no data, so it cannot fail for app reasons. If it answers,
 * functions work and the fault is in the app, and the listing below says where the data
 * actually landed. If it also 502s, the app is not the problem and there is no point looking
 * at it.
 */

export const handler = async () => {
  const out = {
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    moduleDir: (() => { try { return new URL('.', import.meta.url).pathname; } catch { return typeof __dirname === 'string' ? __dirname : 'unknown'; } })(),
    env: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      ALLOW_DEV_ROUTES: process.env.ALLOW_DEV_ROUTES ?? null,
      DATA_DIR: process.env.DATA_DIR ?? null,
      LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT ?? null,
    },
  };

  // Imported here rather than at the top so that even a broken module resolution still lets
  // the rest of the answer through.
  try {
    const fs = await import('node:fs');
    const list = (d) => {
      try { return fs.readdirSync(d).slice(0, 40); }
      catch (e) { return `unreadable: ${e.message}`; }
    };
    out.taskContents = list(process.cwd());
    out.dataContents = list(process.cwd() + '/data');
    out.processedContents = list(process.cwd() + '/data/processed');
    out.flowsExists = fs.existsSync(process.cwd() + '/data/processed/flows.json');
  } catch (e) {
    out.fsError = e.message;
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(out, null, 2),
  };
};
