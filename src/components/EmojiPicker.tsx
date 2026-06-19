// Full, searchable emoji picker rendered as a popup. Keep a few quick emojis
// inline next to the trigger; this popup is for "pick any emoji". Bundled dataset
// (src/lib/emojiData.ts), no dependency. Reusable for both the terminal and
// project (group) emoji menus.

import { useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_CATEGORIES, searchEmojis, type EmojiEntry } from "../lib/emojiData";

interface EmojiPickerProps {
  /** Currently selected emoji char, highlighted in the grid. */
  selected?: string;
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  /**
   * Render inline inside an existing popup (e.g. the project context menu) rather
   * than as a standalone absolute popup: no own positioning/shadow, no outside-click
   * or Escape handling (the host menu owns those), no focus stealing, and selecting
   * does not auto-close (you can keep picking).
   */
  embedded?: boolean;
}

export function EmojiPicker({ selected, onSelect, onClose, embedded = false }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0]?.id ?? "");

  useEffect(() => {
    if (embedded || !onClose) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose?.();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, embedded]);

  useEffect(() => {
    if (!embedded) ref.current?.querySelector("input")?.focus();
  }, [embedded]);

  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchEmojis(query) : null), [query, searching]);
  const visible: EmojiEntry[] =
    results ?? EMOJI_CATEGORIES.find((category) => category.id === activeCategory)?.emojis ?? [];

  return (
    <div
      ref={ref}
      className="emoji-picker"
      style={embedded ? styles.embedded : styles.popup}
      role="dialog"
      aria-label="Emoji picker"
    >
      <input
        className="emoji-picker-search"
        style={styles.search}
        placeholder="Search emoji"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search emoji"
      />

      {!searching && (
        <div style={styles.tabs} role="tablist" aria-label="Emoji categories">
          {EMOJI_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={category.id === activeCategory}
              title={category.label}
              onClick={() => setActiveCategory(category.id)}
              style={{
                ...styles.tab,
                color: category.id === activeCategory ? "var(--accent-live)" : "var(--text-secondary)",
                background: category.id === activeCategory ? "var(--surface-selected)" : "transparent",
              }}
            >
              {category.emojis[0]?.char}
            </button>
          ))}
        </div>
      )}

      <div style={styles.grid} role="listbox" aria-label={searching ? "Search results" : "Emoji"}>
        {visible.map((emoji) => (
          <button
            key={emoji.char}
            type="button"
            role="option"
            aria-selected={emoji.char === selected}
            data-selected={emoji.char === selected ? "true" : "false"}
            title={emoji.name}
            aria-label={emoji.name}
            onClick={() => {
              onSelect(emoji.char);
              if (!embedded) onClose?.();
            }}
            style={{
              ...styles.cell,
              borderColor: emoji.char === selected ? "var(--border-focus)" : "transparent",
              background: emoji.char === selected ? "var(--surface-selected)" : "transparent",
            }}
          >
            {emoji.char}
          </button>
        ))}
        {visible.length === 0 && <div style={styles.empty}>No emoji found</div>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  popup: {
    position: "absolute",
    zIndex: 60,
    width: 264,
    padding: 8,
    display: "grid",
    gap: 8,
    background: "var(--surface-raised)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-popover, 0 12px 32px rgba(0,0,0,0.45))",
    fontFamily: "var(--font-ui)",
  },
  embedded: {
    display: "grid",
    gap: 8,
    width: "100%",
    fontFamily: "var(--font-ui)",
  },
  search: {
    width: "100%",
    padding: "7px 9px",
    fontSize: 12,
    color: "var(--text-primary)",
    background: "var(--surface-base)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    outline: "none",
  },
  tabs: { display: "flex", gap: 2, overflowX: "auto" },
  tab: {
    flex: "0 0 auto",
    width: 30,
    height: 28,
    fontSize: 16,
    lineHeight: 1,
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 2,
    maxHeight: 200,
    overflowY: "auto",
  },
  cell: {
    height: 32,
    fontSize: 18,
    lineHeight: 1,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    padding: 0,
  },
  empty: {
    gridColumn: "1 / -1",
    padding: "16px 8px",
    textAlign: "center",
    fontSize: 12,
    color: "var(--text-secondary)",
  },
};
