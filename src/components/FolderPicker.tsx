import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUp, CaretRight, Check, Eye, EyeSlash, Folder, FolderOpen, House, X } from "@phosphor-icons/react";
import type { FileEntry } from "../lib/types";

interface FolderPickerProps {
  /** Directory to open at. Falls back to the user home directory. */
  initialPath?: string | null;
  title?: string;
  confirmLabel?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    background: "rgba(8, 11, 13, 0.58)",
    backdropFilter: "blur(2px)",
  },
  panel: {
    width: "min(620px, calc(100vw - 48px))",
    height: "min(560px, calc(100vh - 64px))",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-raised)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    overflow: "hidden",
    animation: "workbench-popover-in var(--motion-med) both",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    height: 44,
    padding: "0 10px 0 14px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  iconButton: {
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  breadcrumb: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 1,
    overflowX: "auto",
    whiteSpace: "nowrap",
    scrollbarWidth: "none",
  },
  crumb: {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    padding: "3px 5px",
    borderRadius: "var(--radius-xs)",
    cursor: "pointer",
    flexShrink: 0,
  },
  crumbLast: {
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  filter: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  filterInput: {
    width: "100%",
    height: 28,
    padding: "0 9px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-sunken)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    outline: "none",
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 6,
  },
  row: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 9px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    textAlign: "left",
    cursor: "pointer",
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  state: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    color: "var(--text-secondary)",
    fontSize: 12,
    padding: 20,
    textAlign: "center",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderTop: "1px solid var(--border-subtle)",
    background: "var(--surface-wash)",
  },
  footerPath: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    color: "var(--text-secondary)",
  },
  secondaryButton: {
    height: 30,
    padding: "0 12px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    cursor: "pointer",
  },
  primaryButton: {
    height: 30,
    padding: "0 14px",
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid rgba(167, 255, 0, 0.55)",
    borderRadius: "var(--radius-sm)",
    background: "rgba(167, 255, 0, 0.12)",
    color: "var(--accent-live)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
};

function parentOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

function crumbsFor(path: string): { name: string; path: string }[] {
  const segments = path.split("/").filter(Boolean);
  const crumbs = [{ name: "/", path: "/" }];
  let acc = "";
  for (const segment of segments) {
    acc += `/${segment}`;
    crumbs.push({ name: segment, path: acc });
  }
  return crumbs;
}

export function FolderPicker({ initialPath, title = "Choose project folder", confirmLabel = "Use this folder", onSelect, onClose }: FolderPickerProps) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // Resolve the starting directory once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = initialPath?.trim();
      if (start) {
        if (!cancelled) setPath(start);
        return;
      }
      try {
        const home = await invoke<string>("fs_home_dir");
        if (!cancelled) setPath(home);
      } catch {
        if (!cancelled) setPath("/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  // Load directory entries whenever the path changes.
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFilter("");
    (async () => {
      try {
        const list = await invoke<FileEntry[]>("fs_list_dir", { path });
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) {
          setEntries([]);
          setError(typeof e === "string" ? e : "Could not read this folder.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    filterRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const folders = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        entry.isDir &&
        (showHidden || !entry.isHidden) &&
        (query === "" || entry.name.toLowerCase().includes(query))
    );
  }, [entries, filter, showHidden]);

  const crumbs = path ? crumbsFor(path) : [];
  const atRoot = path === "/" || path === null;

  return (
    <div style={styles.backdrop} onMouseDown={onClose} role="presentation">
      <div
        style={styles.panel}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={styles.header}>
          <span style={styles.headerTitle}>
            <FolderOpen size={15} weight="duotone" color="var(--accent-live)" />
            {title}
          </span>
          <button style={styles.iconButton} onClick={onClose} aria-label="Close folder picker" title="Close">
            <X size={14} />
          </button>
        </div>

        <div style={styles.toolbar}>
          <button
            style={{ ...styles.iconButton, opacity: atRoot ? 0.4 : 1, cursor: atRoot ? "default" : "pointer" }}
            onClick={() => !atRoot && path && setPath(parentOf(path))}
            disabled={atRoot}
            aria-label="Go to parent folder"
            title="Parent folder"
          >
            <ArrowUp size={14} />
          </button>
          <button
            style={styles.iconButton}
            onClick={async () => {
              try {
                setPath(await invoke<string>("fs_home_dir"));
              } catch {
                setPath("/");
              }
            }}
            aria-label="Go to home folder"
            title="Home"
          >
            <House size={14} />
          </button>
          <div style={styles.breadcrumb}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                {index > 0 && <CaretRight size={11} color="var(--text-secondary)" />}
                <button
                  style={{ ...styles.crumb, ...(index === crumbs.length - 1 ? styles.crumbLast : null) }}
                  onClick={() => setPath(crumb.path)}
                  title={crumb.path}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <button
            style={styles.iconButton}
            onClick={() => setShowHidden((value) => !value)}
            aria-label={showHidden ? "Hide hidden folders" : "Show hidden folders"}
            title={showHidden ? "Hide hidden folders" : "Show hidden folders"}
          >
            {showHidden ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>
        </div>

        <div style={styles.filter}>
          <input
            ref={filterRef}
            style={styles.filterInput}
            value={filter}
            placeholder="Filter folders…"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>

        <div style={styles.list}>
          {loading ? (
            <div style={styles.state}>Loading…</div>
          ) : error ? (
            <div style={styles.state}>{error}</div>
          ) : folders.length === 0 ? (
            <div style={styles.state}>{filter ? "No folders match." : "No subfolders here."}</div>
          ) : (
            folders.map((entry) => (
              <button
                key={entry.path}
                className="workspace-secondary-button"
                style={styles.row}
                onDoubleClick={() => setPath(entry.path)}
                onClick={() => setPath(entry.path)}
                title={entry.path}
              >
                <Folder size={16} weight="duotone" color="var(--explorer-folder, var(--accent-info))" />
                <span style={styles.rowName} dir="auto">
                  {entry.name}
                </span>
                <CaretRight size={13} color="var(--text-secondary)" />
              </button>
            ))
          )}
        </div>

        <div style={styles.footer}>
          <span style={styles.footerPath} title={path ?? undefined} dir="auto">
            {path ?? "—"}
          </span>
          <button className="workspace-secondary-button" style={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            className="workspace-primary-button"
            style={{ ...styles.primaryButton, opacity: path ? 1 : 0.4 }}
            disabled={!path}
            onClick={() => path && onSelect(path)}
          >
            <Check size={14} weight="bold" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
