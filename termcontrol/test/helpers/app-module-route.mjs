import fs from 'node:fs';

const workDashboard = fs.readFileSync(new URL('../../app/work-dashboard.mjs', import.meta.url), 'utf8');

/** Serve only the real app module; each fixture retains authority over its API responses. */
export async function serveAppModule(route) {
  if (new URL(route.request().url()).pathname !== '/app/work-dashboard.mjs') return false;
  await route.fulfill({ contentType: 'text/javascript', body: workDashboard });
  return true;
}
