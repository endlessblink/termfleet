import { useEffect } from "react";
import { StatusBar } from "./components/StatusBar";
import { WorkbenchSidebar } from "./components/WorkbenchSidebar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { WorkbenchHeader } from "./components/WorkbenchHeader";
import { useKeybindings } from "./hooks/useKeybindings";
import { useWorkspaceStore } from "./stores/workspace";

function App() {
  useKeybindings();
  const reconcileCanvasState = useWorkspaceStore((state) => state.reconcileCanvasState);

  useEffect(() => {
    reconcileCanvasState();
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
