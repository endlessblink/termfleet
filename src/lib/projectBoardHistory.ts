export const PROJECT_BOARD_HISTORY_KEY = "termfleet.projectBoard.history.v1";

export interface ProjectVisit { root: string; visits: number; lastOpened: number }
export interface ProjectBoardHistory { selected: string; projects: ProjectVisit[] }

export function readProjectBoardHistory(): ProjectBoardHistory {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_BOARD_HISTORY_KEY) ?? "null");
    return {
      selected: typeof value?.selected === "string" ? value.selected : "",
      projects: Array.isArray(value?.projects) ? value.projects.filter((item: ProjectVisit) =>
        typeof item?.root === "string" && Number.isFinite(item.visits) && item.visits > 0 && Number.isFinite(item.lastOpened)) : [],
    };
  } catch { return { selected: "", projects: [] }; }
}

export function recordProjectVisit(history: ProjectBoardHistory, root: string, now = Date.now()): ProjectBoardHistory {
  const previous = history.projects.find((item) => item.root === root);
  return { selected: root, projects: [
    { root, visits: (previous?.visits ?? 0) + 1, lastOpened: now },
    ...history.projects.filter((item) => item.root !== root),
  ].slice(0, 100) };
}

export function projectShortcuts(history: ProjectBoardHistory, roots: string[]) {
  const available = history.projects.filter((item) => roots.includes(item.root));
  return {
    frequent: [...available].sort((a, b) => b.visits - a.visits || b.lastOpened - a.lastOpened || a.root.localeCompare(b.root)).slice(0, 5),
    recent: [...available].sort((a, b) => b.lastOpened - a.lastOpened || a.root.localeCompare(b.root)).slice(0, 5),
  };
}
