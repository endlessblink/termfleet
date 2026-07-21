import type { Group, Tab } from "./types";

export interface ProjectSidebarItem {
  id: string;
  name: string;
  emoji?: string;
  color: string;
  projectRoot?: string;
  count: number;
  current: boolean;
  pinned: boolean;
}

export interface ProjectSidebarSection {
  id: string;
  label: string;
  projects: ProjectSidebarItem[];
}

export interface ProjectSidebarModel {
  total: number;
  inUse: ProjectSidebarItem[];
  sections: ProjectSidebarSection[];
  searchResults: ProjectSidebarItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  devops: "DevOps",
  "bots+automation": "Bots & automation",
  "bots-automation": "Bots & automation",
  "content-creation": "Content creation",
  productivity: "Productivity",
  freelance: "Freelance",
  "web-dev": "Web development",
  "game-dev": "Game development",
  misc: "Miscellaneous",
};

const CATEGORY_ORDER = [
  "devops",
  "bots+automation",
  "content-creation",
  "productivity",
  "freelance",
  "web-dev",
  "game-dev",
  "misc",
  "other-projects",
  "other-locations",
];

function normalizePath(path?: string) {
  return path?.trim().replace(/\/+$/, "") ?? "";
}

function normalizedCategoryId(value: string) {
  return value === "bots-automation" ? "bots+automation" : value;
}

export function projectCategoryForPath(path?: string): { id: string; label: string } {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const workspaceIndex = parts.lastIndexOf("ai-development");
  if (workspaceIndex >= 0) {
    const candidate = parts[workspaceIndex + 1];
    const hasProjectBelowCategory = parts.length > workspaceIndex + 2;
    if (candidate && hasProjectBelowCategory) {
      const id = normalizedCategoryId(candidate.toLowerCase());
      if (CATEGORY_LABELS[id]) return { id, label: CATEGORY_LABELS[id] };
    }
    return { id: "other-projects", label: "Other projects" };
  }

  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const id = normalizedCategoryId(parts[index].toLowerCase());
    if (CATEGORY_LABELS[id]) return { id, label: CATEGORY_LABELS[id] };
  }
  return { id: "other-locations", label: "Other locations" };
}

function compareProjects(left: ProjectSidebarItem, right: ProjectSidebarItem) {
  if (left.current !== right.current) return left.current ? -1 : 1;
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  if (left.count !== right.count) return right.count - left.count;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function compareSections(left: ProjectSidebarSection, right: ProjectSidebarSection) {
  const leftIndex = CATEGORY_ORDER.indexOf(left.id);
  const rightIndex = CATEGORY_ORDER.indexOf(right.id);
  const resolvedLeft = leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex;
  const resolvedRight = rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex;
  return resolvedLeft - resolvedRight || left.label.localeCompare(right.label);
}

export function buildProjectSidebarModel({
  groups,
  tabs,
  activeGroupFilter,
  pinnedProjects,
  query = "",
}: {
  groups: Group[];
  tabs: Tab[];
  activeGroupFilter: string | null;
  pinnedProjects: string[];
  query?: string;
}): ProjectSidebarModel {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    if (tab.groupId) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);
  }
  const normalizedPins = new Set(pinnedProjects.map(normalizePath));
  const projects = groups.map<ProjectSidebarItem>((group) => ({
    id: group.id,
    name: group.name,
    emoji: group.emoji,
    color: group.color,
    projectRoot: group.projectRoot,
    count: counts.get(group.id) ?? 0,
    current: group.id === activeGroupFilter,
    pinned: Boolean(group.projectRoot && normalizedPins.has(normalizePath(group.projectRoot))),
  }));

  const inUse = projects
    .filter((project) => project.current || project.pinned || project.count > 0)
    .sort(compareProjects);
  const sectionMap = new Map<string, ProjectSidebarSection>();
  for (const project of projects.filter((candidate) => !inUse.some((active) => active.id === candidate.id))) {
    const category = projectCategoryForPath(project.projectRoot);
    const section = sectionMap.get(category.id) ?? { ...category, projects: [] };
    section.projects.push(project);
    sectionMap.set(category.id, section);
  }
  const sections = [...sectionMap.values()]
    .map((section) => ({ ...section, projects: section.projects.sort(compareProjects) }))
    .sort(compareSections);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchResults = normalizedQuery
    ? projects
        .filter((project) => `${project.name}\n${project.projectRoot ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
        .sort(compareProjects)
    : [];

  return { total: projects.length, inUse, sections, searchResults };
}
