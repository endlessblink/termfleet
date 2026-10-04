import type { Tab } from './types';

/** Operator focus only. Unknown history keeps its existing relative order. */
export function recentTerminalIds(tabs: Tab[]): string[] {
  return tabs.map((tab, index) => ({tab,index}))
    .sort((a,b) => (b.tab.lastUsedAt ?? 0)-(a.tab.lastUsedAt ?? 0) || a.index-b.index)
    .map(({tab})=>tab.id);
}

/** Keep one snapshot while modifiers are held; focusing a result must not reorder it. */
export class RecentTerminalCycle {
  private ids: string[] = [];
  reset() { this.ids=[]; }
  next(tabs: Tab[], activeId: string | null, direction: 1 | -1): string | null {
    const live = new Set(tabs.map(tab=>tab.id));
    if (!this.ids.length) {
      this.ids=recentTerminalIds(tabs);
      // Include the currently open card first even if it has no recorded history.
      if (activeId && live.has(activeId)) this.ids=[activeId,...this.ids.filter(id=>id!==activeId)];
    }
    this.ids=this.ids.filter(id=>live.has(id));
    if (!this.ids.length) return null;
    const index=this.ids.indexOf(activeId ?? '');
    return this.ids[(index < 0 ? 0 : index+direction+this.ids.length)%this.ids.length];
  }
}

export interface TerminalAttentionTarget {
  tabId: string; paneId: string; kind: 'approval'|'waiting'|'completed'; eventAt: number; sessionId?: string;
}
/** Only reported status/completion qualifies. Silence and terminal output never do. */
export function terminalAttentionTargets(tabs: Tab[]): TerminalAttentionTarget[] {
  return tabs.flatMap(tab=>tab.terminals.flatMap(pane=>{
    const summary=pane.statusSummary;
    if (pane.status==='exited'||pane.status==='failed'||!summary || summary.confidence!=='high') return [];
    const eventAt=summary.completedAt && (summary.status==='idle'||summary.status==='done') ? summary.completedAt : summary.updatedAt ?? 0;
    if (!eventAt) return [];
    const kind: TerminalAttentionTarget['kind'] | null = summary.status==='waiting'||summary.status==='blocked' ? summary.waitingReason==='approval' ? 'approval' : 'waiting'
      : (summary.completedAt || summary.completedByCommand) && (summary.status==='idle'||summary.status==='done') &&
        (pane.reviewedCompletionSessionId !== summary.sessionId || (pane.reviewedCompletionAt ?? 0)<eventAt) ? 'completed' : null;
    return kind ? [{tabId:tab.id,paneId:pane.paneId,kind,eventAt,sessionId:summary.sessionId}] : [];
  })).sort((a,b)=>({approval:0,waiting:1,completed:2}[a.kind]-{approval:0,waiting:1,completed:2}[b.kind])||a.eventAt-b.eventAt);
}

export function isTerminalNavigationShortcut(event: Pick<KeyboardEvent,'ctrlKey'|'altKey'|'metaKey'|'shiftKey'|'key'>) {
  return event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey &&
    ['PageDown','PageUp','Home','n','N'].includes(event.key);
}
