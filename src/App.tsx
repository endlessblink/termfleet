import { useEffect } from "react";
import { dismissStartupScreen } from "./lib/startupScreen";
import { startStatusPollLoop } from "./lib/statusPollLoop";
import { StatusBar } from "./components/StatusBar";
import { WorkbenchSidebar } from "./components/WorkbenchSidebar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { WorkbenchHeader } from "./components/WorkbenchHeader";
import { useKeybindings } from "./hooks/useKeybindings";
import { hydrateWorkspace, useWorkspaceStore } from "./stores/workspace";

startStatusPollLoop();

function App() {
  useKeybindings();
  const reconcileCanvasState = useWorkspaceStore((state) => state.reconcileCanvasState);
  const immersiveTerminal = useWorkspaceStore((state) => state.workspaceUiState.immersiveTerminal);
  const hydrating = useWorkspaceStore((state) => state.hydrating);

  useEffect(() => {
    // Restore the durable on-disk layout + reconcile orphaned session content
    // before reconciling the canvas, then clear the hydration gate.
    let disposed = false;
    const timers: number[] = [];
    let reconciliationQueue = Promise.resolve();
    const reconcile = () => {
      if (disposed) return;
      // Daemon restore and git-context lookups are asynchronous. Serialize
      // retries so an older hydration cannot write an older tab set after a
      // later retry has already discovered more live sessions.
      reconciliationQueue = reconciliationQueue
        .then(() => hydrateWorkspace())
        .finally(() => reconcileCanvasState());
    };
    reconcile();
    reconciliationQueue.finally(() => {
      reconcileCanvasState();
      // The dock launcher restores curated agent sessions into the already-live
      // daemon after the UI starts. Reconcile through the launcher's restore
      // window so those sessions become durable tabs instead of ghosts.
      for (const delay of [500, 2000, 5000, 10000, 20000, 30000]) {
        timers.push(window.setTimeout(reconcile, delay));
      }
    });
    return () => {
      disposed = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [reconcileCanvasState]);

  useEffect(() => {
    if (hydrating) return;

    let paintFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      paintFrame = window.requestAnimationFrame(dismissStartupScreen);
    });

    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (paintFrame) window.cancelAnimationFrame(paintFrame);
    };
  }, [hydrating]);

  return (
    <div className="app-layout" data-immersive-terminal={immersiveTerminal.enabled ? "true" : "false"}>
      {!immersiveTerminal.enabled && <WorkbenchHeader />}
      <div className="app-main">
        {!immersiveTerminal.enabled && <WorkbenchSidebar />}
        <WorkspaceSurface />
      </div>
      {!immersiveTerminal.enabled && <StatusBar />}
    </div>
  );
}

export default App;
