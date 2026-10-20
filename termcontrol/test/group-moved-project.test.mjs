// 2026-10-20: the health-app terminal showed under claude-and-conquer because it was
// opened in that map group, then moved on into the health-app project folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byProject } from '../bridge/prefs.mjs';

const ROOT = '/p/claude-and-conquer';
const pane = (id, cwd, project) => ({ id, cwd, project, mapGroupId: 'g1', mapGroupName: 'claude-and-conquer', turn: 'idle', updatedAt: 1 });
const projects = new Set([ROOT, ROOT + '/health-app']);

test('a terminal working in another project gets its own heading; a plain subfolder stays in its group', () => {
  const groups = byProject([
    pane('a', ROOT, 'claude-and-conquer'),
    pane('b', ROOT + '/health-app', 'health-app'),
    pane('c', ROOT + '/out/guided-20261010', 'guided-20261010'),
  ], { groupRoots: new Map([['g1', ROOT]]), isProject: (dir) => projects.has(dir) });
  assert.deepEqual(groups.map((g) => [g.project, g.panes.map((p) => p.id)]), [['claude-and-conquer', ['a', 'c']], ['health-app', ['b']]]);
  assert.equal(groups[1].mapGroupId, null);
});

test('without known group folders nothing moves', () => {
  const groups = byProject([pane('a', ROOT, 'x'), pane('b', ROOT + '/health-app', 'health-app')]);
  assert.equal(groups.length, 1);
});
