import type { AgentProvider } from "../lib/types";
import { agentProviderIdentity } from "../lib/agentProviderIdentity";

function ClaudeCodeMark() {
  return (
    <svg data-testid="agent-provider-logo-claude" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <g fill="none" stroke="#d97757" strokeWidth="2.15" strokeLinecap="round">
        <path d="M12 2.8v18.4M2.8 12h18.4M5.5 5.5l13 13M18.5 5.5l-13 13" />
      </g>
      <circle cx="12" cy="12" r="2" fill="#d97757" />
    </svg>
  );
}

function CodexMark() {
  const petals = [
    [12, 6.6], [16.7, 9.3], [16.7, 14.7],
    [12, 17.4], [7.3, 14.7], [7.3, 9.3],
  ];
  return (
    <svg data-testid="agent-provider-logo-codex" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.65">
        {petals.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.25" />)}
      </g>
    </svg>
  );
}

export function ShellPromptMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      data-testid="terminal-signifier-logo-shell"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        d="M4 17l6-5-6-5M12 19h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentProviderIdentity({ provider }: { provider?: AgentProvider | null }) {
  const label = agentProviderIdentity(provider);
  if (!label) return null;
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
      aria-label={`${label} agent`}
    >
      {provider === "claude" ? <ClaudeCodeMark /> : provider === "codex" ? <CodexMark /> : null}
      <span>{label}</span>
    </span>
  );
}

export function TerminalSignifier({
  provider,
  showAgent = true,
}: {
  provider?: AgentProvider | string | null;
  showAgent?: boolean;
}) {
  const label = agentProviderIdentity(provider);
  if (label) {
    if (!showAgent) return null;
    return <AgentProviderIdentity provider={provider as AgentProvider} />;
  }
  return (
    <span
      data-testid="terminal-signifier-shell"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
      aria-label="Regular shell terminal"
      title="Regular shell terminal"
    >
      <ShellPromptMark />
      <span>SHELL</span>
    </span>
  );
}

