// TF-105: bare shells (plain shell terminals with no agent) cannot be closed, and
// messages sent to them run as shell commands. This test verifies both fixes:
// 1. closeOwnTerminal skips unsaved-work check for plain shells
// 2. termfleet-team send refuses to send to plain shells
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeOwnTerminal } from '../scripts/lib/team-close.mjs';
import { stateOf } from '../termcontrol/bridge/orchestrate.mjs';

test('closeOwnTerminal: plain shell can close even with unsaved work in shared repo', async () => {
  const shellPane = {
    id: 'terminal-shell-123',
    provider: 'shell',
    project: 'jobrunner',
    cwd: '/tmp/jobrunner',
    alive: true,
    turn: 'idle',
    producing: false,
  };

  const agentPane = {
    id: 'terminal-claude-456',
    provider: 'claude',
    project: 'jobrunner',
    cwd: '/tmp/jobrunner',
    alive: true,
    turn: 'idle',
    producing: false,
  };

  const panes = [shellPane, agentPane];
  const owned = [
    { paneId: 'terminal-shell-123', task: 'bare shell', at: Date.now() - 60000 },
    { paneId: 'terminal-claude-456', task: 'claude agent', at: Date.now() - 120000 },
  ];

  // Mock that returns some unsaved files (simulating other sessions' work)
  const mockUnsaved = () => ['MASTER_PLAN.md', '.directive-validation/README.md', 'package.json'];
  const mockChanges = () => null; // plain shell has no record

  // Shell: closes despite unsaved files (they're not its own)
  const shellResult = await closeOwnTerminal({
    query: 'terminal-shell-123',
    panes,
    owned,
    resolvePane: (panes, q) => ({ pane: panes.find(p => p.id === q) }),
    stateOf: (p) => stateOf(p),
    request: async () => ({ ok: true }),
    record: () => {},
    unsaved: mockUnsaved,
    changes: mockChanges,
    by: 'test',
  });
  assert.equal(shellResult.ok, true, 'plain shell closes without checking unsaved work');

  // Agent: refuses to close due to unsaved files (it might have made them)
  const agentResult = await closeOwnTerminal({
    query: 'terminal-claude-456',
    panes,
    owned,
    resolvePane: (panes, q) => ({ pane: panes.find(p => p.id === q) }),
    stateOf: (p) => stateOf(p),
    request: async () => ({ ok: true }),
    record: () => {},
    unsaved: mockUnsaved,
    changes: mockChanges,
    by: 'test',
  });
  assert.equal(agentResult.ok, false, 'agent refuses to close with unsaved work');
  assert.match(agentResult.text, /has unsaved work/);
});

test('closeOwnTerminal: agent still checks unsaved work, plain shell does not', async () => {
  const panes = [
    {
      id: 'terminal-shell-idle',
      provider: 'shell',
      project: 'test',
      cwd: '/tmp/test',
      alive: true,
      turn: 'idle',
      producing: false,
    },
  ];

  const owned = [{ paneId: 'terminal-shell-idle', task: 'shell', at: Date.now() }];

  // Called with unsaved files, but plain shell should skip this check
  let unsavedCalled = false;
  const mockUnsaved = () => {
    unsavedCalled = true;
    return ['file.txt'];
  };

  const result = await closeOwnTerminal({
    query: 'terminal-shell-idle',
    panes,
    owned,
    resolvePane: (panes, q) => ({ pane: panes.find(p => p.id === q) }),
    stateOf: (p) => stateOf(p),
    request: async () => ({ ok: true }),
    record: () => {},
    unsaved: mockUnsaved,
    changes: () => null,
    by: 'test',
  });

  assert.equal(unsavedCalled, false, 'unsaved check was not called for plain shell');
  assert.equal(result.ok, true, 'plain shell closed without unsaved-work check');
});

test('termfleet-team send refuses to send to plain shell terminals', () => {
  // Verify the send refusal code is in place
  const teamCode = fs.readFileSync(new URL('../scripts/termfleet-team.mjs', import.meta.url), 'utf8');
  assert.match(teamCode, /if\s*\(\s*pane\.provider\s*===\s*['"]shell['"]\s*\)\s*fail/);
  assert.match(teamCode, /plain shell with no agent/);
  assert.match(teamCode, /would run as commands/);
});

test('closeOwnTerminal: other providers still check unsaved work', async () => {
  const codexPane = {
    id: 'terminal-codex-789',
    provider: 'codex',
    project: 'test',
    cwd: '/tmp/test',
    alive: true,
    turn: 'idle',
    producing: false,
  };

  const panes = [codexPane];
  const owned = [{ paneId: 'terminal-codex-789', task: 'codex', at: Date.now() }];

  // Codex should have unsaved check called
  let unsavedCalled = false;
  const mockUnsaved = () => {
    unsavedCalled = true;
    return ['changed-file.txt'];
  };

  const result = await closeOwnTerminal({
    query: 'terminal-codex-789',
    panes,
    owned,
    resolvePane: (panes, q) => ({ pane: panes.find(p => p.id === q) }),
    stateOf: (p) => stateOf(p),
    request: async () => ({ ok: true }),
    record: () => {},
    unsaved: mockUnsaved,
    changes: () => null,
    by: 'test',
  });

  assert.equal(unsavedCalled, true, 'unsaved check was called for codex');
  assert.equal(result.ok, false, 'codex refused to close with unsaved work');
  assert.match(result.text, /has unsaved work/);
});
