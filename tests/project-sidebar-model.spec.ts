import { expect, test } from "@playwright/test";
import {
  buildProjectSidebarModel,
  projectCategoryForPath,
} from "../src/lib/projectSidebarModel";
import type { Group, Tab } from "../src/lib/types";

function project(id: string, name: string, projectRoot: string): Group {
  return { id, name, projectRoot, color: "#7aa2f7", emoji: "[]" };
}

function terminal(id: string, groupId: string): Tab {
  return {
    id,
    title: id,
    emoji: "[]",
    color: "#7aa2f7",
    groupId,
    terminals: [],
    splitLayout: { id: `pane-${id}`, type: "terminal" },
    activePaneId: `pane-${id}`,
  };
}

test("project categories follow the workspace folder hierarchy", () => {
  expect(projectCategoryForPath("/work/ai-development/devops/termfleet")).toEqual({
    id: "devops",
    label: "DevOps",
  });
  expect(projectCategoryForPath("/work/ai-development/bots+automation/paper-bot")).toEqual({
    id: "bots+automation",
    label: "Bots & automation",
  });
  expect(projectCategoryForPath("/work/ai-development/content-creation/arthouse")).toEqual({
    id: "content-creation",
    label: "Content creation",
  });
  expect(projectCategoryForPath("/work/ai-development/recreational")).toEqual({
    id: "other-projects",
    label: "Other projects",
  });
  expect(projectCategoryForPath("/home/person/project")).toEqual({
    id: "other-locations",
    label: "Other locations",
  });
});

test("current live and pinned projects are promoted without duplicating inactive projects", () => {
  const groups = [
    project("termfleet", "termfleet", "/work/ai-development/devops/termfleet"),
    project("flow", "flow-state", "/work/ai-development/productivity/flow-state"),
    project("hermes", "hermes", "/work/ai-development/devops/hermes"),
    project("paper", "paper-bot", "/work/ai-development/bots+automation/paper-bot"),
    project("arthouse", "arthouse", "/work/ai-development/content-creation/arthouse"),
  ];
  const model = buildProjectSidebarModel({
    groups,
    tabs: [terminal("term-1", "termfleet"), terminal("term-2", "termfleet"), terminal("flow-1", "flow")],
    activeGroupFilter: "termfleet",
    pinnedProjects: ["/work/ai-development/devops/hermes"],
  });

  expect(model.inUse.map((item) => [item.name, item.count, item.current, item.pinned])).toEqual([
    ["termfleet", 2, true, false],
    ["hermes", 0, false, true],
    ["flow-state", 1, false, false],
  ]);
  expect(model.sections.map((section) => [section.label, section.projects.map((item) => item.name)])).toEqual([
    ["Bots & automation", ["paper-bot"]],
    ["Content creation", ["arthouse"]],
  ]);
});

test("search includes inactive projects by name or path", () => {
  const groups = [
    project("termfleet", "termfleet", "/work/ai-development/devops/termfleet"),
    project("paper", "paper-bot", "/work/ai-development/bots+automation/paper-bot"),
    project("courses", "courses", "/work/ai-development/freelance/bina-meatzevet-courses"),
  ];
  const model = buildProjectSidebarModel({
    groups,
    tabs: [terminal("term-1", "termfleet")],
    activeGroupFilter: "termfleet",
    pinnedProjects: [],
    query: "freelance",
  });

  expect(model.searchResults.map((item) => item.name)).toEqual(["courses"]);
});
