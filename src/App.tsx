import { useEffect } from "react";
import { StatusBar } from "./components/StatusBar";
import { WorkbenchSidebar } from "./components/WorkbenchSidebar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { WorkbenchHeader } from "./components/WorkbenchHeader";
import { useKeybindings } from "./hooks/useKeybindings";
import { hydrateWorkspace, useWorkspaceStore } from "./stores/workspace";

function App() {
  useKeybindings();
  const reconcileCanvasState = useWorkspaceStore((state) => state.reconcileCanvasState);

  useEffect(() => {
    // Restore the durable on-disk layout + reconcile orphaned session content
    // before reconciling the canvas, then clear the hydration gate.
    void hydrateWorkspace().finally(() => reconcileCanvasState());
  }, [reconcileCanvasState]);

  return (
    <div className="app-layout">
      <WorkbenchHeader />
      <div className="app-main">
        <WorkbenchSidebar />
        <WorkspaceSurface />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
