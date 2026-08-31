import { useEffect } from "react";
import { dismissStartupScreen } from "./lib/startupScreen";
import { startStatusPollLoop } from "./lib/statusPollLoop";
import { StatusBar } from "./components/StatusBar";
import { WorkbenchSidebar } from "./components/WorkbenchSidebar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { WorkbenchHeader } from "./components/WorkbenchHeader";
import { useKeybindings } from "./hooks/useKeybindings";
import { reconnectSavedAgentPanes } from "./lib/agentReconnectRuntime";
import {
  hydrateWorkspace,
  reconcileLiveWorkspace,
  useWorkspaceStore,
} from "./stores/workspace";

startStatusPollLoop();

function App() {
  useKeybindings();
  const reconcileCanvasState = useWorkspaceStore((state) => state.reconcileCanvasState);
  const immersiveTerminal = useWorkspaceStore((state) => state.workspaceUiState.immersiveTerminal);
  const hydrating = useWorkspaceStore((state) => state.hydrating);

  useEffect(() => {
    // Restore and reconnect the durable pane graph once. Late daemon sessions
    // need only the cheap live-session reconciliation; repeating full hydration
    // and transcript recovery made dock startup slow and retried resume commands.
    let disposed = false;
    const timers: number[] = [];
    let reconciliationQueue = Promise.resolve();
    let pendingOwnerRebinds = new Set<string>();

    const reconnectPendingOwners = async () => {
      const state = useWorkspaceStore.getState();
      const intentionallyClosed = [
        ...state.closedSessionIds,
        ...state.recoverySessions
          .filter((session) => session.lifecycle === "intentional-kill")
          .map((session) => session.id),
      ];
      const result = await reconnectSavedAgentPanes(
        state.tabs,
        intentionallyClosed,
        state.closedProviderSessionIds,
        pendingOwnerRebinds.size > 0 ? pendingOwnerRebinds : undefined,
      );
      // The recovery path only reads identity and attaches to an existing daemon
      // session. A rejected/unstable owner observation, or an identity that has
      // not reached the durable recovery records yet, can safely be retried in
      // the bounded late-session window. Confirmed missing sessions and
      // intentionally killed panes remain terminal and are never retried.
      pendingOwnerRebinds = new Set([
        ...result.ownedElsewhere,
        ...result.pendingColdRestore,
        ...result.missingRecovery,
        ...result.failed.map(({ paneId }) => paneId),
      ]);
    };

    const reconcileLateSessions = () => {
      if (disposed) return;
      reconciliationQueue = reconciliationQueue
        .then(async () => {
          await reconcileLiveWorkspace();
          if (disposed) return;
          if (pendingOwnerRebinds.size > 0) {
            await reconnectPendingOwners();
          }
          if (disposed) return;
          reconcileCanvasState();
        })
        .catch((error) => {
          console.warn("Workspace reconciliation failed:", error);
        });
    };

    reconciliationQueue = reconciliationQueue.then(async () => {
      await hydrateWorkspace();
      if (disposed) return;
      reconcileCanvasState();
      // The first pass paints the durable layout quickly. Run the one history /
      // sidecar pass after that paint so exact provider identities are available
      // before recovery, without putting transcript scans on the splash screen.
      await hydrateWorkspace({ background: true });
      if (disposed) return;
      await reconnectPendingOwners();
    });
    reconciliationQueue
      .catch((error) => {
        console.warn("Workspace reconciliation failed:", error);
      })
      .finally(() => {
        reconcileCanvasState();
        // External provider restore is intentionally staggered to avoid a
        // startup burst. Keep reconciling through that bounded window so each
        // restored provider can bind to its exact saved pane as it appears.
        for (const delay of [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000, 24000, 30000, 40000]) {
          timers.push(window.setTimeout(reconcileLateSessions, delay));
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
