import test from 'node:test';
import assert from 'node:assert/strict';

import { pendingAsk, screenPermissionAsk, matchesCurrentAsk } from '../bridge/asks.mjs';
import {
  dedupePanes,
  orderPanesLikeCanvasSidebar,
  reconcileLivePanes,
} from '../bridge/inventory.mjs';
import { visibleFeed } from '../bridge/feed.mjs';
import { byProject } from '../bridge/prefs.mjs';
import { foldCodexStatus } from '../bridge/session-status.mjs';
import * as codex from '../bridge/adapters/codex.mjs';
import * as opencode from '../bridge/adapters/opencode.mjs';

test('only an explicit permission notification exposes approval controls', () => {
  assert.equal(pendingAsk({ provider: 'codex', turn: 'waiting', turnReason: 'operator_question' }), null);

  const ask = pendingAsk({
    provider: 'codex',
    turn: 'waiting',
    turnReason: 'permission_prompt',
    updatedAt: 1720000000000,
  });
  assert.equal(ask?.kind, 'permission');
  assert.deepEqual(ask?.options.map((option) => option.key), ['yes', 'yesAlways', 'no']);
  assert.ok(ask?.id);
});

test('a completed Codex transcript overrides a stale waiting notification', () => {
  const ask = pendingAsk({
    provider: 'codex',
    sessionId: 'completed-session',
    turn: 'waiting',
    turnReason: 'permission_prompt',
    updatedAt: 1720000000000,
  }, {
    codexApproval: () => null,
    codexTranscript: () => '/tmp/completed-session.jsonl',
  });

  assert.equal(ask, null);
});

test('a real unmatched Codex escalated exec call exposes its command and reason', () => {
  const call = {
    timestamp: '2026-09-08T15:16:04.023Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      call_id: 'call-live-approval',
      input: 'const result = await tools.exec_command({cmd:"./scripts/deploy-electron-update.sh",sandbox_permissions:"require_escalated",justification:"Allow publishing the verified update?"});',
    },
  };

  const ask = codex.pendingApprovalFromRecords([call]);
  assert.equal(ask?.kind, 'permission');
  assert.equal(ask?.title, './scripts/deploy-electron-update.sh');
  assert.equal(ask?.detail, 'Allow publishing the verified update?');
  assert.equal(ask?.sourceId, 'call-live-approval');

  const completed = codex.pendingApprovalFromRecords([
    call,
    {
      type: 'response_item',
      payload: { type: 'custom_tool_call_output', call_id: 'call-live-approval', output: 'ok' },
    },
  ]);
  assert.equal(completed, null);
});

test('the namespaced exec call used by live Codex exposes its approval', () => {
  const ask = codex.pendingApprovalFromRecords([{
    timestamp: '2026-09-08T15:16:04.023Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'functions.exec',
      call_id: 'call-live-namespaced-approval',
      input: 'const result = await tools.exec_command({cmd:"npm run release:install",sandbox_permissions:"require_escalated",justification:"Allow installing the verified release?"});',
    },
  }]);

  assert.equal(ask?.kind, 'permission');
  assert.equal(ask?.title, 'npm run release:install');
  assert.equal(ask?.detail, 'Allow installing the verified release?');
  assert.equal(ask?.sourceId, 'call-live-namespaced-approval');
});

test('ordinary unmatched Codex tool calls never become permission prompts', () => {
  const ask = codex.pendingApprovalFromRecords([{
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      call_id: 'call-safe',
      input: 'const result = await tools.exec_command({cmd:"npm test"});',
    },
  }]);
  assert.equal(ask, null);
});

test('Codex persistent approval uses the key shown by the live menu', () => {
  assert.equal(codex.approval.yesAlways, 'p\r');
});

test('a terminal-rendered MCP approval is exposed with its visible choices', () => {
  const ask = screenPermissionAsk({ provider: 'codex', sessionId: 'screen-session', updatedAt: 1720000000000 }, `
Field 1/1
Allow the playwright-isolated MCP server to run tool "browser_run_code_unsafe"?
code: async (page) => ({cwd:process.cwd()})
1. Allow
2. Allow for this session
3. Always allow
4. Cancel
enter to submit | esc to cancel
`);
  assert.equal(ask?.kind, 'permission');
  assert.equal(ask?.title, 'Allow browser_run_code_unsafe?');
  assert.deepEqual(ask?.options.map((option) => [option.key, option.label]), [
    ['1', 'Allow'],
    ['2', 'Allow for this session'],
    ['3', 'Always allow'],
    ['4', 'Cancel'],
  ]);
});

test('ordinary terminal text is not mistaken for an MCP approval', () => {
  assert.equal(screenPermissionAsk({ provider: 'codex' }, 'Allow the server to run tool "x"?\n1. Allow\n2. Cancel'), null);
});

test('a permission answer is bound to the prompt the phone actually saw', () => {
  const pane = {
    provider: 'codex',
    turn: 'waiting',
    turnReason: 'permission_prompt',
    updatedAt: 1720000000000,
  };
  const ask = pendingAsk(pane);
  assert.equal(matchesCurrentAsk(pane, ask.id, 'yes'), true);
  assert.equal(matchesCurrentAsk({ ...pane, updatedAt: pane.updatedAt + 1 }, ask.id, 'yes'), false);
  assert.equal(matchesCurrentAsk(pane, ask.id, 'made-up-choice'), false);
});

test('duplicate observations collapse to one freshest daemon pane identity', () => {
  const panes = dedupePanes([
    { id: 'terminal-a', updatedAt: 100, task: 'old' },
    { id: 'terminal-b', updatedAt: 150, task: 'other' },
    { id: 'terminal-a', updatedAt: 200, task: 'fresh' },
  ]);
  assert.deepEqual(panes.map((pane) => pane.id).sort(), ['terminal-a', 'terminal-b']);
  assert.equal(panes.find((pane) => pane.id === 'terminal-a').task, 'fresh');
});

test('mobile panes preserve the exact desktop map sidebar order', () => {
  const panes = [
    { id: 'terminal-a', updatedAt: 300 },
    { id: 'terminal-b', updatedAt: 100 },
    { id: 'terminal-c', updatedAt: 200 },
    { id: 'terminal-unmapped', updatedAt: 400 },
  ];
  const workspace = {
    groups: [{ id: 'one' }, { id: 'two' }],
    tabs: [
      { id: 'tab-a', groupId: 'one', terminals: [{ id: 'terminal-a' }] },
      { id: 'tab-b', groupId: 'two', terminals: [{ id: 'terminal-b' }] },
      { id: 'tab-c', groupId: 'one', terminals: [{ id: 'terminal-c' }] },
    ],
    canvasState: { nodes: [
      { id: 'node-a', type: 'terminal', terminalTabId: 'tab-a' },
      { id: 'node-b', type: 'terminal', terminalTabId: 'tab-b' },
      { id: 'node-c', type: 'terminal', terminalTabId: 'tab-c' },
    ] },
    workspaceUiState: {
      canvasSidebarManualOrder: ['node-a', 'node-b', 'node-c'],
      canvasSidebarSortMode: 'project',
    },
  };

  const projectOrder = orderPanesLikeCanvasSidebar(panes, workspace);
  assert.deepEqual(projectOrder.map((pane) => pane.id), [
    'terminal-a', 'terminal-c', 'terminal-b', 'terminal-unmapped',
  ]);

  workspace.workspaceUiState.canvasSidebarSortMode = 'manual';
  const manualOrder = orderPanesLikeCanvasSidebar(panes, workspace);
  assert.deepEqual(manualOrder.map((pane) => pane.id), [
    'terminal-a', 'terminal-b', 'terminal-c', 'terminal-unmapped',
  ]);
});

test('activity updates cannot move terminals or projects without a desktop map move', () => {
  const workspace = {
    groups: [{ id: 'one' }, { id: 'two' }],
    tabs: [
      { id: 'tab-a', groupId: 'one', terminals: [{ id: 'terminal-a' }] },
      { id: 'tab-b', groupId: 'two', terminals: [{ id: 'terminal-b' }] },
      { id: 'tab-c', groupId: 'one', terminals: [{ id: 'terminal-c' }] },
    ],
    canvasState: { nodes: [
      { id: 'node-a', type: 'terminal', terminalTabId: 'tab-a' },
      { id: 'node-b', type: 'terminal', terminalTabId: 'tab-b' },
      { id: 'node-c', type: 'terminal', terminalTabId: 'tab-c' },
    ] },
    workspaceUiState: {
      canvasSidebarManualOrder: ['node-a', 'node-b', 'node-c'],
      canvasSidebarSortMode: 'project',
    },
  };
  const first = [
    { id: 'terminal-a', mapGroupId: 'one', project: 'one', turn: 'idle', updatedAt: 100 },
    { id: 'terminal-b', mapGroupId: 'two', project: 'two', turn: 'waiting', updatedAt: 300 },
    { id: 'terminal-c', mapGroupId: 'one', project: 'one', turn: 'working', updatedAt: 200 },
  ];
  const changedActivity = [
    { ...first[2], turn: 'waiting', updatedAt: 900 },
    { ...first[1], turn: 'idle', updatedAt: 700 },
    { ...first[0], turn: 'working', updatedAt: 800 },
  ];

  const viewOrder = (panes) => {
    const ordered = orderPanesLikeCanvasSidebar(panes, workspace);
    return byProject(ordered).map((group) => [
      group.project,
      group.panes.map((pane) => pane.id),
    ]);
  };

  assert.deepEqual(viewOrder(first), [['one', ['terminal-a', 'terminal-c']], ['two', ['terminal-b']]]);
  assert.deepEqual(viewOrder(changedActivity), viewOrder(first));
});

test('every daemon-owned terminal remains visible without an agent status sidecar', () => {
  const workspace = {
    groups: [{ id: 'project-one', name: 'TermFleet', emoji: '🧭', color: '#7aa2f7' }],
    tabs: [
      {
        id: 'tab-agent',
        groupId: 'project-one',
        terminals: [{ id: 'terminal-agent', agentProvider: 'codex' }],
      },
      {
        id: 'tab-shell',
        groupId: 'project-one',
        initialCwd: '/work/termfleet',
        terminals: [{ id: 'terminal-shell', agentProvider: null }],
      },
    ],
    canvasState: { nodes: [
      { id: 'node-agent', type: 'terminal', terminalTabId: 'tab-agent' },
      { id: 'node-shell', type: 'terminal', terminalTabId: 'tab-shell' },
    ] },
    workspaceUiState: {
      canvasSidebarManualOrder: ['node-agent', 'node-shell'],
      canvasSidebarSortMode: 'project',
    },
  };
  const panes = reconcileLivePanes(
    [{ id: 'terminal-agent', provider: 'codex', updatedAt: 100 }],
    new Map([
      ['terminal-agent', { initialCwd: '/work/termfleet' }],
      ['terminal-shell', { initialCwd: '/work/termfleet' }],
    ]),
    workspace,
  );

  assert.deepEqual(panes.map((pane) => pane.id), ['terminal-agent', 'terminal-shell']);
  assert.equal(panes[1].provider, 'shell');
  assert.equal(panes[1].project, 'termfleet');
  assert.equal(new Set(panes.map((pane) => pane.id)).size, panes.length);
});

test('mobile conversation omits internal tools and pending hook chatter', () => {
  const feed = visibleFeed({
    events: [
      { kind: 'user', text: 'please continue' },
      { kind: 'tool', name: 'exec', summary: 'exec_command' },
      { kind: 'assistant', text: 'Continuing now.' },
    ],
    pending: ['exec_command'],
  }, 60);
  assert.deepEqual(feed.events.map((event) => event.kind), ['user', 'assistant']);
  assert.deepEqual(feed.pending, []);
});

test('an OpenCode pane blocked on permission offers the operator answers', () => {
  const ask = pendingAsk({
    provider: 'opencode',
    turn: 'waiting',
    sessionId: 'ses_1',
    updatedAt: 1720000000000,
    task: 'Run the test suite?',
  });
  assert.equal(ask?.kind, 'permission');
  assert.deepEqual(ask?.options.map((option) => option.key), ['yes', 'yesAlways', 'no']);
  assert.ok(ask?.id);

  assert.equal(pendingAsk({ provider: 'opencode', turn: 'idle', sessionId: 'ses_1' }), null);
  assert.equal(pendingAsk({ provider: 'opencode', turn: 'working', sessionId: 'ses_1' }), null);
});

test('OpenCode approvals use its own dialog keys', () => {
  // Enter picks the highlighted "Allow once"; right arrow moves to "Allow
  // always"; Escape is the dialog's bound "Reject".
  assert.equal(opencode.approval.yes, '\r');
  assert.equal(opencode.approval.yesAlways, '\u001b[C\r');
  assert.equal(opencode.approval.no, '\u001b');
});

test('Codex status exposes an active start plus five-hour and weekly remaining limits', () => {
  const status = foldCodexStatus([
    {
      timestamp: '2026-09-08T09:00:00.000Z',
      payload: { type: 'task_started' },
    },
    {
      timestamp: '2026-09-08T09:00:02.000Z',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 13, window_minutes: 300, resets_at: 1788868800 },
          secondary: { used_percent: 42, window_minutes: 10080, resets_at: 1789473600 },
        },
      },
    },
  ]);

  assert.equal(status.workingSince, Date.parse('2026-09-08T09:00:00.000Z'));
  assert.equal(status.limits.fiveHour.remainingPercent, 87);
  assert.equal(status.limits.weekly.remainingPercent, 58);
});

test('a completed Codex turn no longer presents a running timer', () => {
  const status = foldCodexStatus([
    { timestamp: '2026-09-08T09:00:00.000Z', payload: { type: 'task_started' } },
    { timestamp: '2026-09-08T09:02:00.000Z', payload: { type: 'task_complete' } },
  ]);
  assert.equal(status.workingSince, null);
});
