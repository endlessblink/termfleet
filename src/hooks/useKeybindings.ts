import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspaceStore, createNewTab, splitActivePane, closeActivePane } from "../stores/workspace";
import { calculatePaneBounds, findAdjacentPane } from "../lib/splitUtils";
import { terminalHasKeyboardFocus } from "../lib/terminalFocus";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function toggleWindowFullscreen() {
  if (isTauriRuntime()) {
    const currentWindow = getCurrentWindow();
    await currentWindow.setFullscreen(!(await currentWindow.isFullscreen()));
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

export function useKeybindings() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // F11 is the app/window fullscreen escape hatch, so it must work even
      // when the hidden terminal input has focus.
      if (e.key === "F11") {
        e.preventDefault();
        void toggleWindowFullscreen().catch((error) => {
          console.error("Failed to toggle fullscreen:", error);
        });
        return;
      }

      // When a terminal owns the keyboard, every key belongs to the program
      // inside it (zellij, vim, the shell). Bail so the app never steals Ctrl+T,
      // Ctrl+W, Ctrl+Tab, Alt+Arrow, etc. from a focused terminal — that was the
      // "Ctrl+T closes zellij" bug. App shortcuts resume when focus is elsewhere
      // (sidebar, file explorer, command bar). Click out of the terminal to use
      // them, or use the on-screen affordances.
      if (terminalHasKeyboardFocus()) return;

      const store = useWorkspaceStore.getState();

      // Ctrl+T — New tab
      if (e.ctrlKey && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        createNewTab();
        return;
      }

      // Ctrl+W — Close active tab
      if (e.ctrlKey && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (store.activeTabId) {
          store.closeTerminalSession(store.activeTabId);
        }
        return;
      }

      // Ctrl+Tab — Next tab
      if (e.ctrlKey && !e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const { tabs, activeTabId } = store;
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = (idx + 1) % tabs.length;
        store.setActiveTab(tabs[nextIdx].id);
        return;
      }

      // Ctrl+Shift+Tab — Previous tab
      if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const { tabs, activeTabId } = store;
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const prevIdx = (idx - 1 + tabs.length) % tabs.length;
        store.setActiveTab(tabs[prevIdx].id);
        return;
      }

      // Ctrl+Shift+E — Split horizontal (side by side)
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        splitActivePane("horizontal");
        return;
      }

      // Ctrl+Shift+O — Split vertical (stacked)
      if (e.ctrlKey && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        splitActivePane("vertical");
        return;
      }

      // Ctrl+Shift+W — Close active pane
      if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        closeActivePane();
        return;
      }

      // Alt+Arrow — Navigate between panes
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const directionMap: Record<string, "up" | "down" | "left" | "right"> = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
        };
        const direction = directionMap[e.key];
        if (direction) {
          e.preventDefault();
          const tab = store.tabs.find((t) => t.id === store.activeTabId);
          if (!tab) return;

          // Need container size — use the terminal area element
          const area = document.querySelector(".terminal-area");
          if (!area) return;
          const rect = area.getBoundingClientRect();

          const bounds = calculatePaneBounds(tab.splitLayout, {
            left: 0,
            top: 0,
            width: rect.width,
            height: rect.height,
          });

          const adjacent = findAdjacentPane(bounds, tab.activePaneId, direction);
          if (adjacent) {
            store.setActivePane(tab.id, adjacent);
          }
          return;
        }
      }

    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}
