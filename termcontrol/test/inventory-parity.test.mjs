import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { listPanes, reconcileLivePanes } from '../bridge/inventory.mjs';
import { liveness } from '../bridge/liveness.mjs';
import { PATHS } from '../bridge/paths.mjs';

function expectedLiveSidebarOrder(workspace, liveIds) {
  const live = new Set(liveIds);
  const tabs = new Map((workspace.tabs || []).map((tab) => [tab.id, tab]));
  const manual = workspace.workspaceUiState?.canvasSidebarManualOrder || [];
  const positions = new Map(manual.map((id, index) => [id, index]));
  const nodes = (workspace.canvasState?.nodes || [])
    .filter((node) => node?.type === 'terminal')
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const aPosition = positions.get(a.node.id);
      const bPosition = positions.get(b.node.id);
      if (aPosition === undefined && bPosition === undefined) return a.index - b.index;
      if (aPosition === undefined) return 1;
      if (bPosition === undefined) return -1;
      return aPosition - bPosition;
    })
    .map(({ node }) => node);

  let orderedNodes = nodes;
  if (workspace.workspaceUiState?.canvasSidebarSortMode === 'project') {
    const buckets = new Map();
    for (const node of nodes) {
      const groupId = tabs.get(node.terminalTabId)?.groupId || '__unassigned__';
      if (!buckets.has(groupId)) buckets.set(groupId, []);
      buckets.get(groupId).push(node);
    }
    orderedNodes = [...buckets.values()].flat();
  }

  const ordered = [];
  for (const node of orderedNodes) {
    for (const terminal of tabs.get(node.terminalTabId)?.terminals || []) {
      if (live.delete(terminal.id)) ordered.push(terminal.id);
    }
  }
  return [...ordered, ...liveIds.filter((id) => live.delete(id))];
}

test('the phone lists each daemon-owned live terminal exactly once', async () => {
  const life = await liveness();
  assert.equal(life.reachable, true, 'the terminal daemon must be reachable for parity proof');
  const live = [...life.byId.keys()];
  const phone = reconcileLivePanes(listPanes(), life.byId).map((pane) => pane.id);

  assert.equal(phone.length, new Set(phone).size, 'the phone contains duplicate terminal identities');
  assert.deepEqual([...phone].sort(), [...live].sort(), 'the phone and desktop daemon have different live terminal identities');

  const workspace = JSON.parse(fs.readFileSync(PATHS.workspace, 'utf8'));
  assert.deepEqual(phone, expectedLiveSidebarOrder(workspace, live), 'the phone order differs from the TermFleet project sidebar');

  const refreshed = await liveness();
  assert.equal(refreshed.reachable, true, 'the terminal daemon must remain reachable during order verification');
  const afterRefresh = reconcileLivePanes(listPanes(), refreshed.byId).map((pane) => pane.id);
  assert.deepEqual(afterRefresh, phone, 'a liveness refresh moved terminals without the user moving them');
});
