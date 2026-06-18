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

export function workspaceLabelFor(input: {
  project?: Pick<Group, "name"> | null;
  cwd?: string | null;
  tabTitle?: string | null;
  nodeTitle?: string | null;
}) {
  if (input.project?.name?.trim()) return input.project.name.trim();
  const cwdTail = input.cwd?.split("/").filter(Boolean).pop();
  if (cwdTail) return cwdTail;
  const tabTitle = input.tabTitle?.trim();
  if (tabTitle && tabTitle !== "Terminal") return tabTitle;
  const nodeTitle = input.nodeTitle?.trim();
  if (nodeTitle && nodeTitle !== "Terminal") return nodeTitle;
  return "Workspace";
}

export function projectRootFor(groupId: string | null, groups: Group[], activeTab?: Tab) {
  if (groupId === null) return activeTab?.initialCwd ?? null;
  return groups.find((group) => group.id === groupId)?.projectRoot ?? activeTab?.initialCwd ?? null;
}

export function projectSessionCount(groupId: string | null, tabs: Tab[]) {
  if (groupId === null) return tabs.length;
  return tabs.filter((tab) => tab.groupId === groupId).length;
}
