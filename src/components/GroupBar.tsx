import { useState, useCallback, useRef, useEffect, CSSProperties } from "react";
import { useWorkspaceStore } from "../stores/workspace";
import type { Group } from "../lib/types";

const PALETTE_COLORS = [
  { label: "Blue", value: "#7aa2f7" },
  { label: "Green", value: "#9ece6a" },
  { label: "Magenta", value: "#bb9af7" },
  { label: "Red", value: "#f7768e" },
  { label: "Yellow", value: "#e0af68" },
  { label: "Cyan", value: "#7dcfff" },
  { label: "Orange", value: "#ff9e64" },
];

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  bar: {
    height: 36,
    background: "var(--bg-dark)",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    paddingLeft: 8,
    paddingRight: 8,
    gap: 6,
    overflowX: "auto",
    overflowY: "hidden",
    flexShrink: 0,
    userSelect: "none",
  },
  pill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-block",
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 4,
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--fg-dark)",
    fontSize: 16,
    lineHeight: 1,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    flexShrink: 0,
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  },
  formPanel: {
    position: "fixed",
    background: "var(--bg-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 12,
    zIndex: 1000,
    boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 200,
  },
  formInput: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    color: "var(--fg)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    outline: "none",
    padding: "4px 8px",
    width: "100%",
    transition: "border-color 0.1s",
  },
  colorSwatches: {
    display: "flex",
    gap: 5,
    flexWrap: "wrap",
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 4,
    cursor: "pointer",
    border: "2px solid transparent",
    transition: "border-color 0.1s, transform 0.1s",
  },
  formCreateBtn: {
    background: "var(--blue)",
    border: "none",
    borderRadius: 4,
    color: "#1a1b26",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    padding: "5px 12px",
    transition: "opacity 0.1s",
  },
  contextMenu: {
    position: "fixed",
    background: "var(--bg-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "4px 0",
    minWidth: 150,
    zIndex: 1000,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  },
  contextMenuItem: {
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--fg)",
    fontFamily: "var(--font-ui)",
    transition: "background 0.1s",
  },
};

// ── ColorSwatches ─────────────────────────────────────────────────────────────

function ColorSwatches({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (c: string) => void;
}) {
  return (
    <div style={styles.colorSwatches}>
      {PALETTE_COLORS.map(({ value, label }) => (
        <div
          key={value}
          title={label}
          style={{
            ...styles.swatch,
            background: value,
            borderColor: selected === value ? "var(--fg)" : "transparent",
            transform: selected === value ? "scale(1.15)" : "scale(1)",
          }}
          onClick={() => onSelect(value)}
        />
      ))}
    </div>
  );
}

// ── CreateGroupForm ───────────────────────────────────────────────────────────

interface CreateGroupFormProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

function CreateGroupForm({ anchorRect, onClose }: CreateGroupFormProps) {
  const addGroup = useWorkspaceStore((s) => s.addGroup);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE_COLORS[0].value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addGroup(trimmed, color);
    onClose();
  }, [name, color, addGroup, onClose]);

  // Position below anchor
  const top = anchorRect.bottom + 4;
  const left = Math.min(anchorRect.left, window.innerWidth - 220);

  return (
    <div ref={ref} style={{ ...styles.formPanel, top, left }}>
      <input
        ref={inputRef}
        style={styles.formInput}
        placeholder="Group name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") onClose();
        }}
      />
      <ColorSwatches selected={color} onSelect={setColor} />
      <button
        style={{
          ...styles.formCreateBtn,
          opacity: name.trim() ? 1 : 0.5,
          cursor: name.trim() ? "pointer" : "default",
        }}
        onClick={handleCreate}
        disabled={!name.trim()}
      >
        Create
      </button>
    </div>
  );
}

// ── GroupContextMenu ──────────────────────────────────────────────────────────

interface GroupContextMenuState {
  groupId: string;
  x: number;
  y: number;
  mode: "none" | "rename" | "color";
}

interface GroupContextMenuProps {
  menu: GroupContextMenuState;
  group: Group;
  onDismiss: () => void;
}

function GroupContextMenu({ menu, group, onDismiss }: GroupContextMenuProps) {
  const updateGroup = useWorkspaceStore((s) => s.updateGroup);
  const removeGroup = useWorkspaceStore((s) => s.removeGroup);
  const [renameValue, setRenameValue] = useState(group.name);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"none" | "rename" | "color">(menu.mode);

  useEffect(() => {
    if (mode === "rename") inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onDismiss]);

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed) updateGroup(group.id, { name: trimmed });
    onDismiss();
  }

  function MenuItem({
    label,
    danger,
    onClick,
  }: {
    label: string;
    danger?: boolean;
    onClick: () => void;
  }) {
    const [h, setH] = useState(false);
    return (
      <div
        style={{
          ...styles.contextMenuItem,
          background: h ? "var(--selection-bg)" : "transparent",
          color: danger ? "var(--red)" : "var(--fg)",
        }}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        onClick={onClick}
      >
        {label}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ ...styles.contextMenu, top: menu.y, left: menu.x }}
    >
      {mode === "none" && (
        <>
          <MenuItem label="Rename" onClick={() => setMode("rename")} />
          <MenuItem label="Change Color" onClick={() => setMode("color")} />
          <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          <MenuItem
            label="Delete Group"
            danger
            onClick={() => {
              removeGroup(group.id);
              onDismiss();
            }}
          />
        </>
      )}

      {mode === "rename" && (
        <div style={{ padding: "8px 10px", display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            style={{ ...styles.formInput, width: 130 }}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") onDismiss();
              e.stopPropagation();
            }}
          />
        </div>
      )}

      {mode === "color" && (
        <div style={{ padding: 10 }}>
          <ColorSwatches
            selected={group.color}
            onSelect={(c) => {
              updateGroup(group.id, { color: c });
              onDismiss();
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── GroupPill ─────────────────────────────────────────────────────────────────

interface GroupPillProps {
  group: Group;
  isActive: boolean;
  onFilter: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, group: Group) => void;
}

function GroupPill({ group, isActive, onFilter, onContextMenu }: GroupPillProps) {
  const [hovered, setHovered] = useState(false);

  const pillStyle: CSSProperties = {
    ...styles.pill,
    background: isActive
      ? "var(--selection-bg)"
      : hovered
      ? "var(--bg-highlight)"
      : "transparent",
    color: isActive ? "var(--fg)" : "var(--fg-dark)",
    borderColor: isActive ? "var(--border)" : "transparent",
  };

  return (
    <div
      style={pillStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onFilter(group.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, group);
      }}
    >
      <span style={{ ...styles.dot, background: group.color }} />
      <span>{group.name}</span>
    </div>
  );
}

// ── GroupBar ──────────────────────────────────────────────────────────────────

export function GroupBar() {
  const groups = useWorkspaceStore((s) => s.groups);
  const activeGroupFilter = useWorkspaceStore((s) => s.activeGroupFilter);
  const switchProject = useWorkspaceStore((s) => s.switchProject);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [addBtnRect, setAddBtnRect] = useState<DOMRect | null>(null);
  const [groupContextMenu, setGroupContextMenu] =
    useState<GroupContextMenuState | null>(null);
  const [addBtnHovered, setAddBtnHovered] = useState(false);
  const [allHovered, setAllHovered] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const allActive = activeGroupFilter === null;

  const handleAllClick = useCallback(() => {
    switchProject(null);
  }, [switchProject]);

  const handleGroupFilter = useCallback(
    (id: string) => {
      switchProject(activeGroupFilter === id ? null : id);
    },
    [activeGroupFilter, switchProject]
  );

  const handleAddClick = useCallback(() => {
    if (addBtnRef.current) {
      setAddBtnRect(addBtnRef.current.getBoundingClientRect());
    }
    setShowCreateForm((prev) => !prev);
  }, []);

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, group: Group) => {
      e.preventDefault();
      setGroupContextMenu({
        groupId: group.id,
        x: e.clientX,
        y: e.clientY,
        mode: "none",
      });
    },
    []
  );

  const contextMenuGroup = groupContextMenu
    ? groups.find((g) => g.id === groupContextMenu.groupId)
    : null;

  return (
    <>
      <div style={styles.bar}>
        {/* All pill */}
        <div
          style={{
            ...styles.pill,
            background: allActive
              ? "var(--selection-bg)"
              : allHovered
              ? "var(--bg-highlight)"
              : "transparent",
            color: allActive ? "var(--fg)" : "var(--fg-dark)",
            borderColor: allActive ? "var(--border)" : "transparent",
          }}
          onMouseEnter={() => setAllHovered(true)}
          onMouseLeave={() => setAllHovered(false)}
          onClick={handleAllClick}
        >
          All
        </div>

        {/* Group pills */}
        {groups.map((g) => (
          <GroupPill
            key={g.id}
            group={g}
            isActive={activeGroupFilter === g.id}
            onFilter={handleGroupFilter}
            onContextMenu={handleGroupContextMenu}
          />
        ))}

        {/* Add group button */}
        <button
          ref={addBtnRef}
          style={{
            ...styles.addBtn,
            background: addBtnHovered ? "var(--bg-highlight)" : "transparent",
            borderColor: addBtnHovered ? "var(--fg-dark)" : "var(--border)",
            color: addBtnHovered ? "var(--fg)" : "var(--fg-dark)",
          }}
          onMouseEnter={() => setAddBtnHovered(true)}
          onMouseLeave={() => setAddBtnHovered(false)}
          onClick={handleAddClick}
          title="New group"
        >
          +
        </button>
      </div>

      {showCreateForm && addBtnRect && (
        <CreateGroupForm
          anchorRect={addBtnRect}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {groupContextMenu && contextMenuGroup && (
        <GroupContextMenu
          menu={groupContextMenu}
          group={contextMenuGroup}
          onDismiss={() => setGroupContextMenu(null)}
        />
      )}
    </>
  );
}
