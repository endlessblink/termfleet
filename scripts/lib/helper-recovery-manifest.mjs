import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultDataRoot, defaultDaemonSocket, requestDaemon } from '../termfleetctl.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PANE = /^terminal-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Helpers start before the provider assigns a conversation id. Save only a known
// top-level identity in its exact, still-recoverable pane. Inherited nested-agent
// pane ids and later events must never replace a pane's first durable binding.
// This is a preflight, not a daemon-side compare-and-set: lifecycle writes remain
// solely the daemon's responsibility, including an intentional close racing us.
export async function bindHelperRecoveryManifest({
  paneId, provider, payload,
  dataRoot = defaultDataRoot(),
  ask = requestDaemon,
  socketPath = defaultDaemonSocket(),
} = {}) {
  try {
    const event = payload?.hook_event_name ?? payload?.hookEventName;
    if (!['SessionStart', 'UserPromptSubmit'].includes(event)) return false;
    if (!['codex', 'claude'].includes(provider) || !PANE.test(paneId ?? '')) return false;
    if (['agent_id', 'agentId', 'subagent_id', 'subagentId', 'subagent_type',
      'subagent', 'is_subagent', 'isSubagent', 'parent_session_id', 'parentSessionId',
      'parent_thread_id'].some((key) => Boolean(payload?.[key]))) return false;
    const sessionId = payload?.session_id ?? payload?.sessionId;
    const cwd = payload?.cwd;
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return false;
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) return false;

    const stem = join(dataRoot, 'sessions', Buffer.from(paneId).toString('hex'));
    const meta = JSON.parse(readFileSync(`${stem}.meta.json`, 'utf8'));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
    if (meta.providerSessionId != null && meta.providerSessionId !== '') return false;
    if (meta.provider && meta.provider !== provider) return false;
    if (meta.launchProfile && meta.launchProfile !== 'terminal') return false;
    if (typeof meta.cwd !== 'string' || !isAbsolute(meta.cwd) || resolve(meta.cwd) !== resolve(cwd)) return false;
    if (JSON.parse(readFileSync(`${stem}.lifecycle.json`, 'utf8')) !== 'recoverable') return false;

    // CamelCase is the daemon's serde wire contract. Omit restore status/reason:
    // its merge then retains authentication and resume failures. It synthesizes
    // the safe resume command from provider + session, so no command is invented.
    // requestDaemon closes unavailable/timed-out sockets (five-second timeout).
    const response = await ask({
      type: 'updateRecovery', id: paneId,
      update: { cwd: resolve(cwd), provider, launchProfile: 'terminal', providerSessionId: sessionId },
    }, socketPath);
    return response?.ok === true && response.value?.type === 'recoveryUpdated' && response.value.ok === true;
  } catch {
    // A status hook cannot block agent startup on a missing checkpoint/daemon.
    return false;
  }
}
