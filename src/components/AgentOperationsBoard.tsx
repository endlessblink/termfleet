import { ProjectPlansBoard } from "./ProjectPlansBoard";

export function AgentOperationsBoard() {
  return <div style={{ height: "100%", minHeight: 0 }} data-testid="agent-operations-board"><ProjectPlansBoard /></div>;
}
