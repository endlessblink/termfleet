import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FilePlus,
  FolderOpen,
  FolderPlus,
  MapPinned,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { FileEntry } from "../lib/types";
import { createTerminalTab, useWorkspaceStore } from "../stores/workspace";
import { FolderPicker } from "./FolderPicker";

interface TreeNodeState {
  expanded: boolean;
  loading: boolean;
  children: FileEntry[];
  error: string | null;
}

interface ContextMenu {
  x: number;
  y: number;
  entry: FileEntry | null;
}

const BROWSER_ROOT = "/browser-workspace";
const browserFs = new Map<string, FileEntry[]>([
  [
    BROWSER_ROOT,
    [
      { name: "src", path: `${BROWSER_ROOT}/src`, isDir: true, isHidden: false },
      { name: "docs", path: `${BROWSER_ROOT}/docs`, isDir: true, isHidden: false },
      { name: "README.md", path: `${BROWSER_ROOT}/README.md`, isDir: false, isHidden: false },
      { name: "package.json", path: `${BROWSER_ROOT}/package.json`, isDir: false, isHidden: false },
      { name: "MASTER_PLAN.md", path: `${BROWSER_ROOT}/MASTER_PLAN.md`, isDir: false, isHidden: false },
    ],
  ],
  [
    `${BROWSER_ROOT}/src`,
    [
      { name: "components", path: `${BROWSER_ROOT}/src/components`, isDir: true, isHidden: false },
      { name: "hooks", path: `${BROWSER_ROOT}/src/hooks`, isDir: true, isHidden: false },
      { name: "stores", path: `${BROWSER_ROOT}/src/stores`, isDir: true, isHidden: false },
      { name: "main.tsx", path: `${BROWSER_ROOT}/src/main.tsx`, isDir: false, isHidden: false },
    ],
  ],
  [
    `${BROWSER_ROOT}/src/components`,
    [
      { name: "WorkbenchHeader.tsx", path: `${BROWSER_ROOT}/src/components/WorkbenchHeader.tsx`, isDir: false, isHidden: false },
      { name: "WorkspaceSurface.tsx", path: `${BROWSER_ROOT}/src/components/WorkspaceSurface.tsx`, isDir: false, isHidden: false },
      { name: "MagicCanvas.tsx", path: `${BROWSER_ROOT}/src/components/MagicCanvas.tsx`, isDir: false, isHidden: false },
      { name: "Terminal.tsx", path: `${BROWSER_ROOT}/src/components/Terminal.tsx`, isDir: false, isHidden: false },
    ],
  ],
  [
    `${BROWSER_ROOT}/src/hooks`,
    [
      { name: "usePty.ts", path: `${BROWSER_ROOT}/src/hooks/usePty.ts`, isDir: false, isHidden: false },
      { name: "useKeybindings.ts", path: `${BROWSER_ROOT}/src/hooks/useKeybindings.ts`, isDir: false, isHidden: false },
    ],
  ],
  [
    `${BROWSER_ROOT}/src/stores`,
    [
      { name: "workspace.ts", path: `${BROWSER_ROOT}/src/stores/workspace.ts`, isDir: false, isHidden: false },
    ],
  ],
  [
    `${BROWSER_ROOT}/docs`,
    [
      { name: "terminal-cockpit-design-contract.md", path: `${BROWSER_ROOT}/docs/terminal-cockpit-design-contract.md`, isDir: false, isHidden: false },
      { name: "visual-baselines", path: `${BROWSER_ROOT}/docs/visual-baselines`, isDir: true, isHidden: false },
    ],
  ],
  [`${BROWSER_ROOT}/docs/visual-baselines`, []],
]);

const styles: Record<string, CSSProperties> = {
  explorer: {
    width: "var(--file-explorer-width)",
    minWidth: "var(--file-explorer-width)",
    height: "100%",
    background: "#202528",
    borderRight: "1px solid #3a4146",
    color: "var(--explorer-fg)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  titlebar: {
    height: "var(--explorer-titlebar-height)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 var(--explorer-pad-x)",
    borderBottom: "1px solid var(--explorer-border)",
    background: "#242a2d",
    flexShrink: 0,
  },
  title: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    gap: 7,
    color: "var(--explorer-title-fg)",
    fontSize: "var(--explorer-title-size)",
    fontWeight: "var(--explorer-title-weight)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: "var(--explorer-action-size)",
    height: "var(--explorer-action-size)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--explorer-radius-sm)",
    background: "#1d2224",
    color: "var(--explorer-muted)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    lineHeight: 1,
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  rootBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px var(--explorer-pad-x)",
    borderBottom: "1px solid var(--explorer-border)",
    background: "var(--explorer-rootbar-bg)",
    flexShrink: 0,
  },
  pathInput: {
    flex: 1,
    minWidth: 0,
    height: "var(--explorer-input-height)",
    background: "var(--explorer-input-bg)",
    border: "1px solid var(--explorer-input-border)",
    borderRadius: "var(--explorer-radius-sm)",
    color: "var(--explorer-input-fg)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    padding: "0 8px",
    outline: "none",
    transition: "border-color var(--motion-fast), box-shadow var(--motion-fast), background var(--motion-fast)",
  },
  tree: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "var(--explorer-tree-pad-y) 0",
  },
  row: {
    height: "var(--explorer-row-height)",
    display: "flex",
    alignItems: "center",
    gap: 5,
    margin: "0 var(--explorer-row-margin-x)",
    paddingRight: 7,
    borderRadius: "var(--explorer-radius-sm)",
    color: "var(--explorer-fg)",
    fontSize: "var(--explorer-row-font-size)",
    lineHeight: 1.15,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast)",
  },
  rootRow: {
    background: "#30373b",
    color: "var(--explorer-root-fg)",
    fontWeight: "var(--explorer-root-row-weight)",
    boxShadow: "none",
  },
  chevron: {
    width: 14,
    flexShrink: 0,
    textAlign: "center",
    color: "var(--explorer-chevron)",
    fontSize: 13,
  },
  glyph: {
    width: 16,
    height: 16,
    flexShrink: 0,
    position: "relative",
    display: "inline-block",
  },
  name: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  muted: {
    color: "var(--explorer-muted)",
    padding: "8px 12px",
    fontSize: 12,
    lineHeight: 1.4,
  },
  footer: {
    height: "var(--explorer-footer-height)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    padding: "4px 6px",
    borderTop: "1px solid var(--explorer-border)",
    background: "linear-gradient(180deg, var(--surface-wash), var(--explorer-footer-bg))",
    flexShrink: 0,
  },
  footerTab: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: "var(--explorer-radius-md)",
    color: "var(--explorer-muted)",
    fontSize: 12,
    fontWeight: "var(--font-weight-ui-label)",
    height: 20,
    border: "1px solid var(--border-subtle)",
  },
  footerStatus: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--explorer-muted)",
    fontSize: 11,
  },
  footerCount: {
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
  },
  contextMenu: {
    position: "fixed",
    zIndex: 1000,
    minWidth: 190,
    background: "var(--surface-raised)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 4,
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  contextItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "calc(100% - 8px)",
    minHeight: 30,
    margin: "0 4px",
    padding: "6px 8px",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    transition: "background var(--motion-fast), color var(--motion-fast)",
  },
  contextDivider: {
    borderTop: "1px solid var(--border-subtle)",
    margin: "4px 4px",
  },
};

function joinPath(parent: string, name: string) {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function ExplorerContextItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`workspace-explorer-context-item${danger ? " workspace-explorer-context-item--danger" : ""}`}
      style={styles.contextItem}
      onClick={onClick}
    >
      <span
        style={{
          width: 16,
          height: 16,
          display: "inline-grid",
          placeItems: "center",
          color: danger ? "var(--accent-danger)" : "var(--text-secondary)",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function basename(path: string) {
  const cleaned = path.replace(/\/+$/, "");
  return cleaned.split("/").filter(Boolean).pop() ?? (cleaned || "/");
}

function promptName(label: string, fallback = "") {
  const value = window.prompt(label, fallback);
  return value?.trim() || null;
}

function formatExplorerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("reading 'invoke'") ||
    message.includes("__TAURI__") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("not allowed")
  ) {
    return "File explorer is available in the Tauri desktop app. Browser preview cannot read local folders.";
  }
  if (message.toLowerCase().includes("permission")) {
    return "Cannot read this folder. Check file permissions or choose another project root.";
  }
  if (message.toLowerCase().includes("no such file")) {
    return "Folder not found. Check the path and try again.";
  }
  return message || "Could not read this folder.";
}

function sortEntries(entries: FileEntry[]) {
  return [...entries].sort((a, b) =>
    Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}

function browserListDir(path: string) {
  return sortEntries(browserFs.get(path) ?? []);
}

function browserCreateEntry(basePath: string, name: string, isDir: boolean) {
  const parentEntries = browserFs.get(basePath) ?? [];
  const path = joinPath(basePath, name);
  if (parentEntries.some((entry) => entry.name === name)) {
    throw new Error(`${name} already exists`);
  }
  const entry = { name, path, isDir, isHidden: name.startsWith(".") };
  browserFs.set(basePath, sortEntries([...parentEntries, entry]));
  if (isDir) browserFs.set(path, []);
}

function browserRenameEntry(path: string, newName: string) {
  const parent = parentPath(path);
  const entries = browserFs.get(parent) ?? [];
  const current = entries.find((entry) => entry.path === path);
  if (!current) throw new Error("Path not found");
  const newPath = joinPath(parent, newName);
  browserFs.set(
    parent,
    sortEntries(entries.map((entry) =>
      entry.path === path
        ? { ...entry, name: newName, path: newPath, isHidden: newName.startsWith(".") }
        : entry
    ))
  );

  if (current.isDir) {
    const children = browserFs.get(path) ?? [];
    browserFs.delete(path);
    browserFs.set(newPath, children.map((child) => ({
      ...child,
      path: child.path.replace(path, newPath),
    })));
  }

  return newPath;
}

function browserDeleteEntry(path: string) {
  const parent = parentPath(path);
  browserFs.set(parent, (browserFs.get(parent) ?? []).filter((entry) => entry.path !== path));
  Array.from(browserFs.keys()).forEach((key) => {
    if (key === path || key.startsWith(`${path}/`)) browserFs.delete(key);
  });
}

function extensionClass(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (!extension) return "var(--explorer-file)";
  if (["css", "scss", "sass"].includes(extension)) return "var(--explorer-file-style)";
  if (["html", "xml", "svg"].includes(extension)) return "var(--explorer-file-markup)";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension)) return "var(--explorer-file-js)";
  if (["md", "mdx"].includes(extension)) return "var(--explorer-file-md)";
  if (["json", "yaml", "yml", "toml"].includes(extension)) return "var(--explorer-file-data)";
  if (["rs", "go", "py", "rb"].includes(extension)) return "var(--explorer-file-code)";
  return "var(--explorer-file)";
}

function fileBadge(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (!extension) return "";
  if (["ts", "tsx"].includes(extension)) return "TS";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "JS";
  if (["md", "mdx"].includes(extension)) return "M";
  if (["json"].includes(extension)) return "{}";
  if (["yaml", "yml", "toml"].includes(extension)) return "Y";
  if (["css", "scss", "sass"].includes(extension)) return "#";
  if (["html", "xml", "svg"].includes(extension)) return "<>";
  if (extension === "rs") return "R";
  if (extension === "py") return "Py";
  return "";
}

function ExplorerIcon({
  type,
  name,
  open = false,
}: {
  type: "workspace" | "folder" | "file" | "source";
  name?: string;
  open?: boolean;
}) {
  if (type === "source") {
    return <span style={{ width: 16, textAlign: "center", color: "var(--explorer-muted)" }}>⌁</span>;
  }

  if (type === "file") {
    const color = extensionClass(name ?? "");
    const badge = fileBadge(name ?? "");
    return (
      <span style={styles.glyph} aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
          <path
            d="M4 1.8h5.7L13 5.1v9.1H4z"
            fill={color}
          />
          <path
            d="M9.7 1.8v3.3H13z"
            fill="rgba(255,255,255,0.34)"
          />
          <path
            d="M4 1.8h5.7L13 5.1v9.1H4z"
            fill="none"
            stroke="rgba(0,0,0,0.22)"
            strokeWidth="0.7"
          />
        </svg>
        {badge && (
          <span
            style={{
              position: "absolute",
              left: 2,
              right: 1,
              bottom: 2,
              color: "var(--explorer-icon-label)",
              fontSize: badge.length > 1 ? 5.2 : 6.5,
              fontWeight: 500,
              lineHeight: 1,
              textAlign: "center",
              fontFamily: "var(--font-ui)",
            }}
          >
            {badge}
          </span>
        )}
      </span>
    );
  }

  const color = type === "workspace" ? "var(--explorer-workspace)" : "var(--explorer-folder)";
  const tabColor = type === "workspace" ? "var(--explorer-workspace-tab)" : "var(--explorer-folder-tab)";
  const shadeColor = type === "workspace" ? "var(--explorer-workspace-shade)" : "var(--explorer-folder-shade)";
  return (
    <span style={styles.glyph} aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
        <path
          d="M1.6 4.2h4.5l1.2 1.4h7.1v1.6H1.6z"
          fill={tabColor}
        />
        <path
          d="M1.6 5.7h12.8c.5 0 .8.4.7.9l-.8 6.1c-.1.6-.5 1-1.1 1H2.8c-.6 0-1-.4-1.1-1L.9 6.6c-.1-.5.2-.9.7-.9z"
          fill={color}
        />
        <path
          d="M2.1 12.6h11.8l.1-.9H2z"
          fill={shadeColor}
          opacity={open ? 0.9 : 0.62}
        />
        <path
          d="M1.6 5.7h12.8c.5 0 .8.4.7.9l-.8 6.1c-.1.6-.5 1-1.1 1H2.8c-.6 0-1-.4-1.1-1L.9 6.6c-.1-.5.2-.9.7-.9z"
          fill="none"
          stroke="rgba(0,0,0,0.24)"
          strokeWidth="0.55"
        />
      </svg>
    </span>
  );
}

interface TreeRowProps {
  entry: FileEntry;
  depth: number;
  nodeState: TreeNodeState | undefined;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggle: (entry: FileEntry) => void;
  onOpenFile: (entry: FileEntry) => void;
  onContextMenu: (event: React.MouseEvent, entry: FileEntry | null) => void;
  renderChildren: (entries: FileEntry[], depth: number) => React.ReactNode;
}

function TreeRow({
  entry,
  depth,
  nodeState,
  selectedPath,
  onSelect,
  onToggle,
  onOpenFile,
  onContextMenu,
  renderChildren,
}: TreeRowProps) {
  const expanded = !!nodeState?.expanded;
  const selected = selectedPath === entry.path;
  const selectedStyle: CSSProperties = selected
    ? {
        background: "linear-gradient(90deg, rgba(217, 154, 69, 0.16), rgba(217, 154, 69, 0.05))",
        boxShadow: "var(--shadow-selected-row)",
      }
    : {};

  return (
    <>
      <div
        className="workspace-explorer-row"
        data-selected={selected ? "true" : "false"}
        style={{
          ...styles.row,
          paddingLeft: 4 + depth * 13,
          color: entry.isHidden ? "var(--explorer-hidden)" : "var(--explorer-fg)",
          background: selected ? String(selectedStyle.background) : "transparent",
          boxShadow: selected ? String(selectedStyle.boxShadow) : "none",
        }}
        title={entry.path}
        tabIndex={0}
        onClick={() => {
          onSelect(entry.path);
          if (entry.isDir) onToggle(entry);
          else onOpenFile(entry);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect(entry.path);
          if (entry.isDir) onToggle(entry);
          else onOpenFile(entry);
        }}
        onContextMenu={(event) => onContextMenu(event, entry)}
      >
        <span style={styles.chevron}>{entry.isDir ? (expanded ? "⌄" : "›") : ""}</span>
        <ExplorerIcon type={entry.isDir ? "folder" : "file"} name={entry.name} open={expanded} />
        <span style={styles.name} dir="auto">{entry.name}</span>
      </div>
      {entry.isDir && expanded && (
        <>
          {nodeState?.loading && <div style={{ ...styles.muted, paddingLeft: 24 + depth * 13 }}>Loading...</div>}
          {nodeState?.error && (
            <div style={{ ...styles.muted, paddingLeft: 24 + depth * 13 }}>{nodeState.error}</div>
          )}
          {nodeState && !nodeState.loading && renderChildren(nodeState.children, depth + 1)}
        </>
      )}
    </>
  );
}

export function FileExplorer() {
  const tauriAvailable = "__TAURI_INTERNALS__" in window;
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const setProjectRoot = useWorkspaceStore((state) => state.setProjectRoot);
  const addOpenFile = useWorkspaceStore((state) => state.addOpenFile);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const uiState = useWorkspaceStore((state) => state.workspaceUiState);
  const updateUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const [rootInput, setRootInput] = useState(projectRoot ?? "");
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const resolvedRoot = useMemo(() => projectRoot ?? rootInput, [projectRoot, rootInput]);

  const listDir = useCallback(async (path: string) => {
    if (!tauriAvailable) {
      return browserListDir(path);
    }
    return invoke<FileEntry[]>("fs_list_dir", { path });
  }, [tauriAvailable]);

  const refreshRoot = useCallback(async (path: string) => {
    if (!path) return;
    setLoadingRoot(true);
    setError(null);
    try {
      const entries = await listDir(path);
      setRootEntries(entries);
    } catch (requestError) {
      setError(formatExplorerError(requestError));
    } finally {
      setLoadingRoot(false);
    }
  }, [listDir]);

  const refreshNode = useCallback(async (path: string) => {
    setNodes((current) => ({
      ...current,
      [path]: {
        expanded: true,
        loading: true,
        children: current[path]?.children ?? [],
        error: null,
      },
    }));

    try {
      const children = await listDir(path);
      setNodes((current) => ({
        ...current,
        [path]: { expanded: true, loading: false, children, error: null },
      }));
    } catch (requestError) {
      setNodes((current) => ({
        ...current,
        [path]: {
          expanded: true,
          loading: false,
          children: current[path]?.children ?? [],
          error: formatExplorerError(requestError),
        },
      }));
    }
  }, [listDir]);

  useEffect(() => {
    if (!tauriAvailable) {
      const root = projectRoot?.startsWith(BROWSER_ROOT) ? projectRoot : BROWSER_ROOT;
      setRootInput(root);
      setProjectRoot(root);
      setRootEntries(browserListDir(root));
      setError(null);
      return;
    }

    if (projectRoot) {
      setRootInput(projectRoot);
      refreshRoot(projectRoot);
      return;
    }

    invoke<string>("fs_home_dir")
      .then((home) => {
        setRootInput(home);
        setProjectRoot(home);
      })
      .catch((requestError) => setError(formatExplorerError(requestError)));
  }, [projectRoot, refreshRoot, setProjectRoot, tauriAvailable]);

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, []);

  const handleToggle = useCallback((entry: FileEntry) => {
    const nodeState = nodes[entry.path];
    if (nodeState?.expanded) {
      setNodes((current) => ({
        ...current,
        [entry.path]: { ...nodeState, expanded: false },
      }));
      return;
    }
    refreshNode(entry.path);
  }, [nodes, refreshNode]);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    addOpenFile({ path: entry.path, name: entry.name, dirty: false });
  }, [addOpenFile]);

  const chooseProjectFolder = useCallback(() => {
    if (!tauriAvailable) {
      const selected = window.prompt("Project folder", rootInput);
      if (selected?.trim()) setProjectRoot(selected.trim());
      return;
    }
    setPickerOpen(true);
  }, [rootInput, setProjectRoot, tauriAvailable]);

  const refreshParent = useCallback((path: string) => {
    if (path === resolvedRoot || parentPath(path) === resolvedRoot) {
      refreshRoot(resolvedRoot);
      return;
    }
    refreshNode(parentPath(path));
  }, [refreshNode, refreshRoot, resolvedRoot]);

  const createEntry = useCallback(async (basePath: string, isDir: boolean) => {
    const name = promptName(isDir ? "Folder name" : "File name");
    if (!name) return;
    try {
      if (!tauriAvailable) {
        browserCreateEntry(basePath, name, isDir);
      } else {
        await invoke("fs_create", { path: joinPath(basePath, name), isDir });
      }
      if (basePath === resolvedRoot) refreshRoot(resolvedRoot);
      else refreshNode(basePath);
    } catch (requestError) {
      setError(formatExplorerError(requestError));
    }
  }, [refreshNode, refreshRoot, resolvedRoot, tauriAvailable]);

  const renameEntry = useCallback(async (entry: FileEntry) => {
    const newName = promptName("Rename", entry.name);
    if (!newName || newName === entry.name) return;
    try {
      if (!tauriAvailable) {
        browserRenameEntry(entry.path, newName);
      } else {
        await invoke<string>("fs_rename", { path: entry.path, newName });
      }
      refreshParent(entry.path);
    } catch (requestError) {
      setError(formatExplorerError(requestError));
    }
  }, [refreshParent, tauriAvailable]);

  const deleteEntry = useCallback(async (entry: FileEntry) => {
    const ok = window.confirm(`Delete ${entry.path}?`);
    if (!ok) return;
    try {
      if (!tauriAvailable) {
        browserDeleteEntry(entry.path);
      } else {
        await invoke("fs_delete", { path: entry.path });
      }
      refreshParent(entry.path);
    } catch (requestError) {
      setError(formatExplorerError(requestError));
    }
  }, [refreshParent, tauriAvailable]);

  const addEntryToCanvas = useCallback((entry: FileEntry) => {
    const nodeCount = useWorkspaceStore.getState().canvasState.nodes.length;
    addCanvasNode({
      type: entry.isDir ? "terminal" : "file",
      title: entry.name,
      x: 140 + (nodeCount % 5) * 32,
      y: 110 + (nodeCount % 6) * 30,
      width: entry.isDir ? 320 : 340,
      height: entry.isDir ? 170 : 150,
      filePath: entry.isDir ? undefined : entry.path,
      terminalCwd: entry.isDir ? entry.path : undefined,
      content: entry.path,
    });
    if (!entry.isDir) {
      addOpenFile({ path: entry.path, name: entry.name, dirty: false });
    }
    setWorkspaceMode("canvas");
  }, [addCanvasNode, addOpenFile, setWorkspaceMode]);

  const onContextMenu = useCallback((event: React.MouseEvent, entry: FileEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, entry });
  }, []);

  const renderChildren = useCallback((entries: FileEntry[], depth: number): React.ReactNode => (
    entries.map((entry) => (
      <TreeRow
        key={entry.path}
        entry={entry}
        depth={depth}
        nodeState={nodes[entry.path]}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        onToggle={handleToggle}
        onOpenFile={handleOpenFile}
        onContextMenu={onContextMenu}
        renderChildren={renderChildren}
      />
    ))
  ), [handleOpenFile, handleToggle, nodes, onContextMenu, selectedPath]);

  if (uiState.fileExplorerCollapsed) {
    return null;
  }

  const contextBase = contextMenu?.entry?.isDir
    ? contextMenu.entry.path
    : contextMenu?.entry
    ? parentPath(contextMenu.entry.path)
    : resolvedRoot;
  const folderCount = rootEntries.filter((entry) => entry.isDir).length;
  const fileCount = rootEntries.length - folderCount;

  return (
    <aside
      style={{
        ...styles.explorer,
        ["--file-explorer-width" as string]: `${uiState.fileExplorerWidth}px`,
      }}
      onContextMenu={(event) => onContextMenu(event, null)}
    >
      <div style={styles.titlebar}>
        <span style={styles.title}>
          <ExplorerIcon type="workspace" open />
          Explorer
        </span>
        <div style={styles.actions}>
          <button style={styles.iconButton} title="Choose project folder" aria-label="Choose project folder" onClick={chooseProjectFolder}>
            <FolderOpen size={14} strokeWidth={1.8} />
          </button>
          <button style={styles.iconButton} title="New file" aria-label="New file" onClick={() => createEntry(resolvedRoot, false)}>
            <FilePlus size={14} strokeWidth={1.8} />
          </button>
          <button style={styles.iconButton} title="New folder" aria-label="New folder" onClick={() => createEntry(resolvedRoot, true)}>
            <FolderPlus size={14} strokeWidth={1.8} />
          </button>
          <button style={styles.iconButton} title="Refresh" aria-label="Refresh" onClick={() => refreshRoot(resolvedRoot)}>
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
          <button style={styles.iconButton} title="Hide files" aria-label="Hide files" onClick={() => updateUiState({ fileExplorerCollapsed: true })}>
            <PanelLeftClose size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div style={styles.rootBar}>
        <input
          style={styles.pathInput}
          dir="auto"
          value={rootInput}
          onChange={(event) => setRootInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") setProjectRoot(rootInput);
          }}
        />
        <button style={styles.iconButton} title="Use typed folder" aria-label="Use typed folder" onClick={() => setProjectRoot(rootInput)}>
          <FolderOpen size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div style={styles.tree}>
        <div
          className="workspace-explorer-row"
          data-selected={selectedPath === resolvedRoot ? "true" : "false"}
          style={{
            ...styles.row,
            ...styles.rootRow,
            paddingLeft: 4,
            background: selectedPath === resolvedRoot
              ? "linear-gradient(90deg, rgba(217, 154, 69, 0.16), rgba(217, 154, 69, 0.05))"
              : String(styles.rootRow.background),
          }}
          title={resolvedRoot}
          tabIndex={0}
          onClick={() => {
            setSelectedPath(resolvedRoot);
            refreshRoot(resolvedRoot);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setSelectedPath(resolvedRoot);
            refreshRoot(resolvedRoot);
          }}
          onContextMenu={(event) => onContextMenu(event, null)}
        >
          <span style={styles.chevron}>⌄</span>
          <ExplorerIcon type="workspace" open />
          <span style={styles.name} dir="auto">{basename(resolvedRoot)}</span>
        </div>

        {loadingRoot && <div style={styles.muted}>Loading...</div>}
        {error && <div style={styles.muted}>{error}</div>}
        {!loadingRoot && !error && rootEntries.length === 0 && (
          <div style={styles.muted}>No files</div>
        )}
        {renderChildren(rootEntries, 0)}
      </div>

      <div style={styles.footer}>
        <div
          className="workspace-explorer-footer-tab"
          style={{
            ...styles.footerTab,
            padding: "0 10px",
            background: "rgba(217, 154, 69, 0.12)",
            borderColor: "rgba(217, 154, 69, 0.38)",
            color: "var(--accent-live)",
          }}
        >
          <ExplorerIcon type="workspace" open />
          Files
        </div>
        <div style={styles.footerStatus} title={`${folderCount} folders, ${fileCount} files at root`}>
          <span style={styles.footerCount}>{rootEntries.length}</span>
          <span>{folderCount} dirs</span>
          <span>{fileCount} files</span>
        </div>
        <button
          className="workspace-explorer-footer-button"
          style={styles.iconButton}
          title="Hide files"
          aria-label="Hide files"
          onClick={() => updateUiState({ fileExplorerCollapsed: true })}
        >
          <PanelLeftClose size={14} strokeWidth={1.8} />
        </button>
      </div>

      {contextMenu && (
        <div
          className="workspace-explorer-context-menu"
          style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <ExplorerContextItem
            icon={<TerminalSquare size={14} strokeWidth={1.8} />}
            label="Open terminal here"
            onClick={() => { createTerminalTab(contextBase); setContextMenu(null); }}
          />
          {contextMenu.entry && (
            <ExplorerContextItem
              icon={<MapPinned size={14} strokeWidth={1.8} />}
              label="Add to map"
              onClick={() => { addEntryToCanvas(contextMenu.entry!); setContextMenu(null); }}
            />
          )}
          <div style={styles.contextDivider} />
          <ExplorerContextItem
            icon={<FilePlus size={14} strokeWidth={1.8} />}
            label="New file"
            onClick={() => { createEntry(contextBase, false); setContextMenu(null); }}
          />
          <ExplorerContextItem
            icon={<FolderPlus size={14} strokeWidth={1.8} />}
            label="New folder"
            onClick={() => { createEntry(contextBase, true); setContextMenu(null); }}
          />
          {contextMenu.entry && (
            <>
              <div style={styles.contextDivider} />
              <ExplorerContextItem
                icon={<Pencil size={14} strokeWidth={1.8} />}
                label="Rename"
                onClick={() => { renameEntry(contextMenu.entry!); setContextMenu(null); }}
              />
              <ExplorerContextItem
                icon={<Trash2 size={14} strokeWidth={1.8} />}
                label="Delete"
                danger
                onClick={() => { deleteEntry(contextMenu.entry!); setContextMenu(null); }}
              />
            </>
          )}
        </div>
      )}
      {pickerOpen && (
        <FolderPicker
          initialPath={resolvedRoot || null}
          onSelect={(selected) => {
            setRootInput(selected);
            setProjectRoot(selected);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  );
}
