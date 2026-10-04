import fs from 'node:fs';
import path from 'node:path';

// A projection of the existing generator's export, never a second planner.
export function deskRoot(pane) {
  let dir = path.resolve(pane.cwd || '/');
  for (let i = 0; i < 6; i++) {
    if (path.basename(dir) === 'freelance-desk' && fs.existsSync(path.join(dir, 'scripts/live_timeline.py'))) return dir;
    const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
  }
  return null;
}
const string = value => typeof value === 'string' ? value : '';
function readJson(file) {
  const stat = fs.statSync(file);
  if (stat.size > 2 * 1024 * 1024) throw new Error('Export is too large');
  return { data: JSON.parse(fs.readFileSync(file, 'utf8')), modified: stat.mtimeMs };
}
export function readDesk(pane, { root = deskRoot(pane), now = Date.now() } = {}) {
  if (!root) return { available: false, error: 'This terminal has no Freelance Desk timeline.' };
  try {
    const { data, modified } = readJson(path.join(root, '.state/live-timeline.json'));
    const buckets = ['today', 'overdue', 'week', 'later', 'undated'];
    if (!/^\d{4}-\d{2}-\d{2}T/.test(data.generated || '') || !Array.isArray(data.fixed_blocks) || buckets.some(key => !Array.isArray(data[key]))) throw new Error('Invalid export');
    const stale = now - modified > 6 * 3600_000 || modified > now + 60_000;
    const result = { available: true, source: 'Live Timeline', generated: data.generated, day: data.generated.slice(0,10), stale,
      fixed_blocks: data.fixed_blocks.filter(b => !['done', 'dropped'].includes(b.status)).map(b => ({ date:string(b.date),time:string(b.time),what:string(b.what),note:string(b.note),source:string(b.source) })),
      calendar: { available: false, stale: true }, calendar_events: [], gaps: ['FlowState is not included in this export.'] };
    for (const key of buckets) result[key] = data[key].map(r => ({ id:string(r.id),title:string(r.title),note:string(r.note),status:string(r.status),due:string(r.due) }));
    try {
      const { data: cache } = readJson(path.join(root, '.state/timeline-calendar.json'));
      const at = Number(cache.at) * 1000;
      if (!Array.isArray(cache.lines) || !Number.isFinite(at) || at > now + 60_000) throw new Error('Invalid cache');
      result.calendar = { available: true, stale: now - at > 20 * 60_000 || cache.day !== result.day, checkedAt: new Date(at).toISOString() };
      result.calendar_events = cache.lines.map(line => String(line).match(/^(\d{4}-\d{2}-\d{2})\s+([^|]+)\s+\|\s*(.*)$/)).filter(Boolean).map(m => ({ date:m[1],time:m[2].trim(),title:m[3] }));
      if (result.calendar.stale) result.gaps.push('Calendar cache is old. Events may have changed.');
    } catch { result.gaps.push('Calendar has not been read here. Refresh it through Freelance Desk.'); }
    if (stale) result.gaps.unshift('The timeline export is old. Ask Freelance Desk to refresh it.');
    return result;
  } catch {
    return { available: false, error: 'The Live Timeline export is missing or unreadable. Ask Freelance Desk to regenerate it.', source: 'Live Timeline' };
  }
}
