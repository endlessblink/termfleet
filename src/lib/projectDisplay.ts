import type { Group, Tab } from "./types";

export function pathTail(path?: string | null, segments = 2) {
  if (!path) return "interactive shell";
  return path.split("/").filter(Boolean).slice(-segments).join("/") || path;
}

export function projectNameFor(groupId: string | null, groups: Pick<Group, "id" | "name">[]) {
  if (groupId === null) return "All projects";
  return groups.find((group) => group.id === groupId)?.name ?? "Project";
}

export function projectForTab(tab: Pick<Tab, "groupId"> | undefined, groups: Group[]) {
  if (!tab?.groupId) return null;
  return groups.find((group) => group.id === tab.groupId) ?? null;
}

export function projectRootFor(groupId: string | null, groups: Group[], activeTab?: Tab) {
  if (groupId === null) return activeTab?.initialCwd ?? null;
  return groups.find((group) => group.id === groupId)?.projectRoot ?? activeTab?.initialCwd ?? null;
}

export function projectSessionCount(groupId: string | null, tabs: Tab[]) {
  if (groupId === null) return tabs.length;
  return tabs.filter((tab) => tab.groupId === groupId).length;
}
