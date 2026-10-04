import { useWorkspaceStore } from '../stores/workspace';
import { RecentTerminalCycle, terminalAttentionTargets } from './terminalNavigation';

// One controller per window; persisted focus times remain shared workspace data.
export const recentTerminalCycle = new RecentTerminalCycle();
export function focusTerminal(tabId: string, paneId?: string) {
 const store=useWorkspaceStore.getState();
 if (!store.tabs.some(tab=>tab.id===tabId)) return;
 store.setActiveTab(tabId);
 if (paneId) store.setActivePane(tabId,paneId);
 const node=store.canvasState.nodes.find(node=>node.terminalTabId===tabId);
 if (node && store.workspaceUiState.workspaceMode==='canvas') {
  const zoom=store.canvasState.viewport.zoom || 1;
  store.updateCanvasViewport({x:window.innerWidth/2-(node.x+node.width/2)*zoom,y:window.innerHeight/2-(node.y+node.height/2)*zoom},'header-focus');
 }
 requestAnimationFrame(()=>{
  const tab=useWorkspaceStore.getState().tabs.find(tab=>tab.id===tabId);
  const pane=tab?.terminals.find(pane=>pane.paneId===(paneId??tab.activePaneId));
  const elements=Array.from(document.querySelectorAll<HTMLElement>('.terminal-block-shell[data-pane-id]'));
  const root=elements.find(element=>element.dataset.paneId===pane?.paneId);
  root?.querySelector<HTMLElement>('textarea, input')?.focus();
 });
}
export function cycleRecentTerminal(direction: 1|-1) {
 const store=useWorkspaceStore.getState();
 const id=recentTerminalCycle.next(store.tabs,store.activeTabId,direction);
 if (id) focusTerminal(id);
}
export function focusNextAttentionTerminal() {
 const store=useWorkspaceStore.getState();
 const targets=terminalAttentionTargets(store.tabs);
 if (!targets.length) return false;
 const index=targets.findIndex(target=>target.tabId===store.activeTabId && target.paneId===store.tabs.find(tab=>tab.id===store.activeTabId)?.activePaneId);
 const target=targets[(index+1)%targets.length];
 focusTerminal(target.tabId,target.paneId);
 // Only an explicit attention navigation acknowledges a completion. Waiting stays
 // outstanding until its provider reports resolution; no auto-focus or auto-ack.
 if (target.kind==='completed') {
  const tab=useWorkspaceStore.getState().tabs.find(tab=>tab.id===target.tabId);
  if (tab) store.updateTab(tab.id,{terminals:tab.terminals.map(pane=>pane.paneId===target.paneId?{...pane,reviewedCompletionAt:target.eventAt,reviewedCompletionSessionId:target.sessionId}:pane)});
 }
 return true;
}
