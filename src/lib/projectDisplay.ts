import type { Group, Tab } from "./types";

export function pathTail(path?: string | null, segments = 2) {
  if (!path) return "interactive shell";
  return path.split("/").filter(Boolean).slice(-segments).join("/") || path;
}

export function projectNameFor(groupId: string | null, groups: Pick<Group, "id" | "name">[]) {
  if (groupId === null) return "All sessions";
  return groups.find((group) => group.id === groupId)?.name ?? "Project";
}

export function projectForTab(tab: Pick<Tab, "groupId"> | undefined, groups: Group[]) {
  if (!tab?.groupId) return null;
  return groups.find((group) => group.id === tab.groupId) ?? null;
}

/** True when `path` is the same directory as `root` or nested inside it. */
function isPathWithin(path: string, root: string): boolean {
  const p = path.replace(/\/+$/, "");
  const r = root.replace(/\/+$/, "");
  if (!r) return false;
  return p === r || p.startsWith(`${r}/`);
}

export function workspaceLabelFor(input: {
  project?: Pick<Group, "name" | "projectRoot"> | null;
  cwd?: string | null;
  tabTitle?: string | null;
  nodeTitle?: string | null;
}) {
  const projectName = input.project?.name?.trim() || undefined;
  const projectRoot = input.project?.projectRoot?.trim() || undefined;
  const cwd = input.cwd?.trim() || undefined;
  const cwdTail = cwd?.split("/").filter(Boolean).pop();

  // The assigned project names the terminal ONLY while it is actually inside that
  // project's root. If the terminal has cd'd outside it (e.g. an app-default
  // "termfleet" group while the shell runs in another repo), the live folder is
  // the truthful identity — never keep showing a stale/default project label.
  if (projectName) {
    const navigatedAway = !!projectRoot && !!cwd && !isPathWithin(cwd, projectRoot);
    if (!navigatedAway) return projectName;
    if (cwdTail) return cwdTail;
    return projectName;
  }

  if (cwdTail) return cwdTail;
  const tabTitle = input.tabTitle?.trim();
  if (tabTitle && tabTitle !== "Terminal") return tabTitle;
  const nodeTitle = input.nodeTitle?.trim();
  if (nodeTitle && nodeTitle !== "Terminal") return nodeTitle;
  return "Workspace";
}

// The header breadcrumb's name. A selected project filter keeps that project's
// identity; otherwise the folder you're actually in (live cwd, then project
// root) wins over any static default — so launching inside a project folder
// shows that folder's name, never "All sessions".
export function headerProjectLabel(input: {
  groupFilter: string | null;
  groups: Pick<Group, "id" | "name">[];
  cwd?: string | null;
  projectRoot?: string | null;
  fallback?: string;
}): string {
  if (input.groupFilter !== null) {
    const name = input.groups.find((group) => group.id === input.groupFilter)?.name?.trim();
    if (name) return name;
  }
  const tail = (input.cwd ?? input.projectRoot)?.split("/").filter(Boolean).pop();
  if (tail) return tail;
  return input.fallback ?? "All sessions";
}

export function projectRootFor(groupId: string | null, groups: Group[], activeTab?: Tab) {
  if (groupId === null) return activeTab?.initialCwd ?? null;
  return groups.find((group) => group.id === groupId)?.projectRoot ?? activeTab?.initialCwd ?? null;
}

export function projectSessionCount(groupId: string | null, tabs: Tab[]) {
  if (groupId === null) return tabs.length;
  return tabs.filter((tab) => tab.groupId === groupId).length;
}
