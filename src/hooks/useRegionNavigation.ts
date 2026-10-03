import { useEffect } from "react";
import { terminalHasKeyboardFocus } from "../lib/terminalFocus";

// Keyboard flow for the whole cockpit (design step 3.1).
//
//  * F6 / Shift+F6 cycle the four regions: header -> rail -> sidebar -> main.
//    F6 is also the xterm F6 key, so while a terminal owns the keyboard it still
//    goes to the program inside it; use the escape hatch instead.
//  * Ctrl+; is the terminal escape hatch: from anywhere (including a focused
//    terminal) it moves focus to the next region, so Tab/F6 can always leave a
//    terminal. keymap.ts maps no byte sequence for Ctrl+; so nothing is taken
//    from programs that did not already ignore it.
//  * Roving focus in the list-like regions (sessions, map rows, explorer tree):
//    ArrowUp/ArrowDown/Home/End move between rows; once a row has focus the other
//    rows leave the Tab order so a single Tab leaves the list.

type Region = {
  id: "header" | "rail" | "sidebar" | "main";
  /** Elements that count as "inside" this region. */
  contains: (el: Element) => boolean;
  /** Where focus lands when the region is entered. */
  target: () => HTMLElement | null;
};

const ROW_SELECTOR = ".session-sidebar-row, .workspace-sidebar-row, .canvas-sidebar-row, .workspace-explorer-row";

function visible(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? el : null;
}

const REGIONS: Region[] = [
  {
    id: "header",
    contains: (el) => Boolean(el.closest("header.workbench-header")),
    target: () => visible(document.querySelector<HTMLElement>(".workbench-command-search input")),
  },
  {
    id: "rail",
    contains: (el) => Boolean(el.closest('nav[aria-label="Operations rail"]')),
    target: () =>
      visible(
        document.querySelector<HTMLElement>('nav[aria-label="Operations rail"] .workspace-rail-button[data-active="true"]') ??
          document.querySelector<HTMLElement>('nav[aria-label="Operations rail"] button'),
      ),
  },
  {
    id: "sidebar",
    contains: (el) => Boolean(el.closest(ROW_SELECTOR)) || Boolean(el.closest("[data-region='sidebar']")),
    target: () =>
      visible(
        document.querySelector<HTMLElement>(
          '.workspace-sidebar-row[data-active="true"], .canvas-sidebar-row[data-selected="true"], .workspace-explorer-row[data-selected="true"]',
        ) ?? document.querySelector<HTMLElement>(ROW_SELECTOR),
      ),
  },
  {
    id: "main",
    contains: (el) => Boolean(el.closest("main.workspace-surface")),
    target: () =>
      visible(
        document.querySelector<HTMLElement>('.terminal-pane-frame[data-active="true"] .terminal-canvas-input') ??
          document.querySelector<HTMLElement>(".terminal-canvas-input") ??
          document.querySelector<HTMLElement>("main.workspace-surface button, main.workspace-surface [tabindex='0']"),
      ),
  },
];

function currentRegionIndex(): number {
  const active = document.activeElement;
  if (!(active instanceof Element)) return -1;
  return REGIONS.findIndex((region) => region.contains(active));
}

export function cycleRegion(direction: 1 | -1): boolean {
  const start = currentRegionIndex();
  for (let step = 1; step <= REGIONS.length; step += 1) {
    const index = (((start === -1 ? (direction === 1 ? -1 : 0) : start) + direction * step) % REGIONS.length + REGIONS.length) % REGIONS.length;
    const target = REGIONS[index].target();
    if (target) {
      target.focus();
      return true;
    }
  }
  return false;
}

function rowsInGroup(row: HTMLElement): HTMLElement[] {
  const parent = row.parentElement;
  if (!parent) return [row];
  const scope = row.closest("[role='tree'], [role='list'], aside, nav, section, main") ?? parent;
  return Array.from(scope.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter((el) => el.getBoundingClientRect().height > 0);
}

export function useRegionNavigation() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey) return;
      const terminalOwnsKeyboard = terminalHasKeyboardFocus();

      // Escape hatch: Ctrl+; from anywhere.
      if (event.ctrlKey && !event.shiftKey && (event.key === ";" || event.code === "Semicolon")) {
        if (cycleRegion(1)) {
          event.preventDefault();
          // Runs before the terminal's own capture listener; keep the key away from it.
          event.stopImmediatePropagation();
        }
        return;
      }

      if (event.key === "F6" && !event.ctrlKey) {
        if (terminalOwnsKeyboard) return; // F6 belongs to the program in the terminal
        if (cycleRegion(event.shiftKey ? -1 : 1)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // Roving focus in row lists.
      if (event.ctrlKey || event.shiftKey || terminalOwnsKeyboard) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(ROW_SELECTOR)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const rows = rowsInGroup(target);
      const index = rows.indexOf(target);
      if (index === -1) return;
      const next =
        event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault();
      rows[next]?.focus();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(ROW_SELECTOR)) return;
      for (const row of rowsInGroup(target)) {
        if (row !== target && row.getAttribute("tabindex") === "0") row.setAttribute("tabindex", "-1");
      }
      if (target.getAttribute("tabindex") === "-1") target.setAttribute("tabindex", "0");
    };

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
}
