import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkspace } from '../bridge/inventory.mjs';
import { PATHS } from '../bridge/paths.mjs';

test('workspace filters stale cards while preserving restored terminals, order and disk data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stale-canvas-'));
  const originalPath = PATHS.workspace;
  const card = (id, terminalTabId) => ({ id, type: 'terminal', terminalTabId });
  const workspace = {
    tabs: [
      { id: 'live', terminals: [{ id: 'current' }], earlierSessions: [{ ptyIds: ['terminal-retired-leaf'] }] },
      { id: 'restoring', terminals: [], splitLayout: { type: 'terminal', id: 'leaf' } },
      { id: 'empty', terminals: [] },
      { id: 'closed', terminals: [], splitLayout: { type: 'terminal', id: 'leaf' } },
      { id: 'retired', terminals: [], splitLayout: { type: 'terminal', id: 'leaf' } },
    ],
    closedSessionIds: ['terminal-closed-leaf'],
    canvasState: { viewport: { x: 12 }, nodes: [
      card('gone-card', 'gone'), card('live-card', 'live'),
      { id: 'note', type: 'note', text: 'Keep this' },
      card('empty-card', 'empty'), card('restore-card', 'restoring'),
      card('closed-card', 'closed'), card('retired-card', 'retired'),
    ] },
    workspaceUiState: { canvasSidebarManualOrder: ['restore-card', 'live-card'] },
  };
  try {
    PATHS.workspace = path.join(directory, 'workspace.json');
    const saved = JSON.stringify(workspace);
    fs.writeFileSync(PATHS.workspace, saved);
    const projected = readWorkspace();
    assert.deepEqual(projected.canvasState.nodes.map(n => n.id), ['live-card', 'note', 'restore-card']);
    assert.equal(projected.tabs[1].terminals[0].id, 'terminal-restoring-leaf');
    assert.deepEqual(projected.canvasState.viewport, workspace.canvasState.viewport);
    assert.deepEqual(projected.workspaceUiState, workspace.workspaceUiState);
    assert.deepEqual(projected.tabs[0].earlierSessions, workspace.tabs[0].earlierSessions);
    assert.equal(fs.readFileSync(PATHS.workspace, 'utf8'), saved);
    assert.strictEqual(readWorkspace(), projected, 'cached reads keep the projection');
    fs.writeFileSync(PATHS.workspace, '{');
    assert.strictEqual(readWorkspace(), projected, 'partial writes retain the last good projection');
  } finally {
    PATHS.workspace = originalPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
