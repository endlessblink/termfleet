import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { asksSidecarFileName, parseAsksSidecar, railRows, type RailRow } from "../lib/requestsRail";
import "./RequestsRail.css";

const FOLD_KEY = "termfleet-requests-rail";
const MIN_PANE_WIDTH = 720;

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "folded";
  } catch {
    return false;
  }
}

/**
 * Narrow, foldable list of this terminal's requests (the operator's words + status),
 * newest at the bottom, about four rows in view. Reads the file the bridge keeps per
 * terminal and polls it, so a request moving to done shows up by itself.
 */
export function RequestsRail({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<RailRow[]>([]);
  const [folded, setFolded] = useState(readFolded);
  const [wide, setWide] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const stick = useRef<number | null>(null); // null = show the top (newest first)

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const raw = await invoke<string | null>("agent_status_read_sidecar", { fileName: asksSidecarFileName(sessionId) });
        if (cancelled) return;
        const parsed = parseAsksSidecar(raw);
        setRows(parsed ? railRows(parsed.asks, parsed.working, parsed.live) : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  // Only where there is room: a narrow card keeps its whole terminal.
  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWide(parent.clientWidth >= MIN_PANE_WIDTH));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [rows.length > 0]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = stick.current === null ? 0 : stick.current;
  }, [rows, folded, wide]);

  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? "folded" : "open");
    } catch {
      /* remembering is a convenience */
    }
  };

  if (!rows.length) return <div ref={rootRef} hidden />;
  const done = rows.filter((r) => r.tone === "done").length;
  const open = rows.filter((r) => r.tone !== "done" && r.tone !== "dropped").length;
  return (
    <div
      ref={rootRef}
      className={`requests-rail${folded ? " requests-rail--folded" : " requests-rail--open"}`}
      hidden={!wide}
      data-testid="requests-rail"
      onPointerDownCapture={(event) => event.stopPropagation()}
    >
      <button type="button" className="requests-rail__toggle" aria-expanded={!folded} onClick={toggle}>
        <span>{open ? `${open} open \u00b7 ${done} done` : `All ${rows.length} done`}</span>
        <span aria-hidden="true">{folded ? "\u25b8" : "\u25be"}</span>
      </button>
      {!folded && (
        <ul
          ref={listRef}
          className="requests-rail__list"
          onScroll={(event) => {
            const list = event.currentTarget;
            stick.current = list.scrollTop < 8 ? null : list.scrollTop;
          }}
        >
          {rows.map((row) => (
            <li key={row.n} className={`requests-rail__row requests-rail__row--${row.tone}`}>
              <span className="requests-rail__text" dir="auto">{row.tone === "working" && row.main !== row.text ? <i className="requests-rail__dot" aria-hidden="true" /> : null}{row.main}</span>
              <span className="requests-rail__word" dir="auto">{row.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
