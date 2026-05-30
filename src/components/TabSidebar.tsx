import { useState, useCallback, useRef, useEffect, CSSProperties } from "react";
import { useWorkspaceStore, createNewTab } from "../stores/workspace";
import type { Tab, Group } from "../lib/types";

function tabBadge(tab: Tab) {
  const text = `${tab.title} ${tab.initialCwd ?? ""}`.toLowerCase();
  if (text.includes("log")) return "LG";
  if (text.includes("git")) return "GT";
  if (text.includes("server") || text.includes("dev")) return "SR";
  if (text.includes("build") || text.includes("test")) return "BD";
  if (text.includes("db") || text.includes("data")) return "DB";
  if (tab.initialCwd) return "FS";
  return "SH";
}

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
  submenu: "none" | "group";
}

interface InlineEditState {
  tabId: string;
  field: "title";
  value: string;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: "var(--sidebar-width)",
    minWidth: "var(--sidebar-width)",
    height: "100%",
    background: "var(--sidebar-bg)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    userSelect: "none",
    position: "relative",
  },
  tabList: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
  },
  header: {
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 9px 0 10px",
    borderBottom: "1px solid var(--border)",
    background: "#11161b",
    color: "var(--fg)",
    fontSize: 13,
    fontWeight: 500,
  },
  headerMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--fg-dark)",
    fontSize: 11,
    fontWeight: 500,
  },
  hideButton: {
    width: 22,
    height: 22,
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "transparent",
    color: "var(--fg-dark)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
  },
  newTabBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 36,
    background: "transparent",
    border: "none",
    borderTop: "1px solid var(--border)",
    color: "var(--fg-dark)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
    width: "100%",
    flexShrink: 0,
  },
  contextMenu: {
    position: "fixed",
    background: "var(--bg-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "4px 0",
    minWidth: 160,
    zIndex: 1000,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  },
  contextMenuItem: {
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--fg)",
    fontFamily: "var(--font-ui)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    transition: "background 0.1s",
  },
  submenuPanel: {
    position: "fixed",
    background: "var(--bg-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 8,
    zIndex: 1001,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  },
  inlineInput: {
    background: "var(--bg)",
    border: "1px solid var(--blue)",
    borderRadius: 3,
    color: "var(--fg)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    outline: "none",
    padding: "1px 4px",
    width: "100%",
  },
  tabBadge: {
    width: 26,
    height: 20,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "var(--bg-elevated)",
    color: "var(--fg)",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 0,
    flexShrink: 0,
    marginLeft: 6,
  },
};

// ── TabRow ──────────────────────────────────────────────────────────────────

interface TabRowProps {
  tab: Tab;
  isActive: boolean;
  groups: Group[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
  inlineEdit: InlineEditState | null;
  onInlineEditChange: (value: string) => void;
  onInlineEditCommit: () => void;
}

function TabRow({
  tab,
  isActive,
  onSelect,
  onRemove,
  onContextMenu,
  inlineEdit,
  onInlineEditChange,
  onInlineEditCommit,
}: TabRowProps) {
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = inlineEdit?.tabId === tab.id;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: 36,
    cursor: "pointer",
    background: isActive
      ? "var(--tab-active-bg)"
      : hovered
      ? "var(--tab-hover-bg)"
      : "var(--tab-bg)",
    borderLeft: `4px solid ${tab.color}`,
    paddingRight: 8,
    gap: 6,
    position: "relative",
    transition: "background 0.12s",
    overflow: "hidden",
  };

  const titleStyle: CSSProperties = {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    color: isActive ? "var(--fg)" : "var(--fg-dark)",
  };

  const closeBtnStyle: CSSProperties = {
    flexShrink: 0,
    background: "transparent",
    border: "none",
    color: "var(--fg-dark)",
    fontSize: 15,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 2px",
    borderRadius: 3,
    opacity: hovered || isActive ? 1 : 0,
    transition: "opacity 0.15s, background 0.1s",
    fontFamily: "var(--font-ui)",
  };

  return (
    <div
      style={rowStyle}
      onClick={() => onSelect(tab.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, tab.id);
      }}
    >
      <span style={{ ...styles.tabBadge, borderColor: tab.color }} title="Terminal badge">
        {tabBadge(tab)}
      </span>

      {isEditing ? (
        <input
          ref={inputRef}
          style={styles.inlineInput}
          value={inlineEdit!.value}
          onChange={(e) => onInlineEditChange(e.target.value)}
          onBlur={onInlineEditCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onInlineEditCommit();
            if (e.key === "Escape") onInlineEditCommit();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span style={titleStyle}>{tab.title}</span>
      )}

      <button
        style={closeBtnStyle}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(tab.id);
        }}
        tabIndex={-1}
        title="Close tab"
        aria-label={`Close ${tab.title} terminal session`}
      >
        ×
      </button>
    </div>
  );
}

// ── Extracted sub-components (hooks can't be called inside .map()) ───────────

function GroupOption({ group, onClick }: { group: Group | null; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <div
      style={{
        ...styles.contextMenuItem,
        background: h ? "var(--selection-bg)" : "transparent",
        gap: 8,
      }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={onClick}
    >
      {group !== null && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: group.color,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
      )}
      <span>{group === null ? "None" : group.name}</span>
    </div>
  );
}

// ── ContextMenu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  menu: ContextMenuState;
  groups: Group[];
  onRename: (tabId: string) => void;
  onMoveToGroup: (tabId: string, groupId: string | null) => void;
  onClose: (tabId: string) => void;
  onDismiss: () => void;
  setSubmenu: (submenu: "none" | "group") => void;
}

function ContextMenu({
  menu,
  groups,
  onRename,
  onMoveToGroup,
  onClose,
  onDismiss,
  setSubmenu,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onDismiss]);

  const menuStyle: CSSProperties = {
    ...styles.contextMenu,
    top: menu.y,
    left: menu.x,
  };

  const submenuStyle: CSSProperties = {
    ...styles.submenuPanel,
    top: menu.y,
    left: menu.x + 164,
  };

  function ItemRow({
    label,
    danger,
    onClick,
    hasArrow,
    active,
  }: {
    label: string;
    danger?: boolean;
    onClick: () => void;
    hasArrow?: boolean;
    active?: boolean;
  }) {
    const [h, setH] = useState(false);
    return (
      <div
        style={{
          ...styles.contextMenuItem,
          background: h || active ? "var(--selection-bg)" : "transparent",
          color: danger ? "var(--red)" : "var(--fg)",
        }}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        onClick={onClick}
      >
        <span>{label}</span>
        {hasArrow && <span style={{ opacity: 0.5, fontSize: 11 }}>▶</span>}
      </div>
    );
  }

  return (
    <div ref={menuRef}>
      <div style={menuStyle}>
        <ItemRow
          label="Rename"
          onClick={() => {
            onRename(menu.tabId);
            onDismiss();
          }}
        />
        <ItemRow
          label="Move to Group"
          hasArrow
          active={menu.submenu === "group"}
          onClick={() => setSubmenu(menu.submenu === "group" ? "none" : "group")}
        />
        <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
        <ItemRow
          label="Close"
          danger
          onClick={() => {
            onClose(menu.tabId);
            onDismiss();
          }}
        />
      </div>

      {menu.submenu === "group" && (
        <div style={submenuStyle}>
          {[null, ...groups].map((g) => (
            <GroupOption
              key={g === null ? "__none__" : g.id}
              group={g}
              onClick={() => {
                onMoveToGroup(menu.tabId, g === null ? null : g.id);
                onDismiss();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── TabSidebar ───────────────────────────────────────────────────────────────

export function TabSidebar() {
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const groups = useWorkspaceStore((s) => s.groups);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeGroupFilter = useWorkspaceStore((s) => s.activeGroupFilter);
  const workspaceMode = useWorkspaceStore((s) => s.workspaceUiState.workspaceMode);
  const collapsed = useWorkspaceStore((s) => s.workspaceUiState.terminalSidebarCollapsed);
  const tabs = activeGroupFilter === null
    ? allTabs
    : allTabs.filter((t) => t.groupId === activeGroupFilter);
  const closeTerminalSession = useWorkspaceStore((s) => s.closeTerminalSession);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((s) => s.setWorkspaceMode);
  const updateUiState = useWorkspaceStore((s) => s.updateWorkspaceUiState);
  const updateTab = useWorkspaceStore((s) => s.updateTab);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [newTabHovered, setNewTabHovered] = useState(false);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY, submenu: "none" });
    setInlineEdit(null);
  }, []);

  const handleRename = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      setInlineEdit({ tabId, field: "title", value: tab.title });
    },
    [tabs]
  );

  const handleInlineEditCommit = useCallback(() => {
    if (!inlineEdit) return;
    const trimmed = inlineEdit.value.trim();
    if (trimmed) {
      updateTab(inlineEdit.tabId, { title: trimmed });
    }
    setInlineEdit(null);
  }, [inlineEdit, updateTab]);

  const handleMoveToGroup = useCallback(
    (tabId: string, groupId: string | null) => {
      updateTab(tabId, { groupId });
    },
    [updateTab]
  );

  const handleDismissMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setWorkspaceMode("split");
  }, [setActiveTab, setWorkspaceMode]);

  const setSubmenu = useCallback((submenu: "none" | "group") => {
    setContextMenu((prev) => (prev ? { ...prev, submenu } : null));
  }, []);

  if (workspaceMode !== "split" || collapsed) return null;

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <span>Sessions</span>
        <span style={styles.headerMeta}>
          {tabs.length}
          <button
            style={styles.hideButton}
            title="Hide sessions"
            onClick={() => updateUiState({ terminalSidebarCollapsed: true })}
          >
            x
          </button>
        </span>
      </div>
      <div style={styles.tabList}>
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            groups={groups}
            onSelect={handleSelectTab}
            onRemove={closeTerminalSession}
            onContextMenu={handleContextMenu}
            inlineEdit={inlineEdit}
            onInlineEditChange={(val) =>
              setInlineEdit((prev) => (prev ? { ...prev, value: val } : null))
            }
            onInlineEditCommit={handleInlineEditCommit}
          />
        ))}
      </div>

      <button
        style={{
          ...styles.newTabBtn,
          background: newTabHovered ? "var(--bg-highlight)" : "transparent",
          color: newTabHovered ? "var(--fg)" : "var(--fg-dark)",
        }}
        onMouseEnter={() => setNewTabHovered(true)}
        onMouseLeave={() => setNewTabHovered(false)}
        onClick={() => {
          createNewTab();
          setWorkspaceMode("split");
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        <span>New Tab</span>
      </button>

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          groups={groups}
          onRename={handleRename}
          onMoveToGroup={handleMoveToGroup}
          onClose={closeTerminalSession}
          onDismiss={handleDismissMenu}
          setSubmenu={setSubmenu}
        />
      )}
    </div>
  );
}
