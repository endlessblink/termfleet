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
    void hydrateWorkspace().finally(() => reconcileCanvasState());
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
