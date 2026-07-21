import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Pause, Play, RefreshCcw } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";

const DEFAULT_PREVIEW_URL = "http://127.0.0.1:3000";

const styles: Record<string, CSSProperties> = {
  shell: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-sunken)",
    color: "var(--text-primary)",
  },
  toolbar: {
    height: 42,
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 10px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent-success)",
    boxShadow: "0 0 0 3px rgba(127, 198, 129, 0.12)",
  },
  statusText: {
    minWidth: 68,
    color: "var(--text-muted)",
    fontSize: 11,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  form: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 26,
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-sunken)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    padding: "0 9px",
    outline: "none",
  },
  button: {
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
  quickButton: {
    height: 26,
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 11,
    padding: "0 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  frameWrap: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    background: "#fff",
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: 0,
    background: "#fff",
  },
  offlineOverlay: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "var(--surface-sunken)",
    color: "var(--text-secondary)",
    textAlign: "center",
    pointerEvents: "none",
  },
  offlineTitle: {
    margin: 0,
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 500,
  },
  offlineDetail: {
    margin: "8px 0 0",
    maxWidth: 380,
    color: "var(--text-muted)",
    fontSize: 12,
    lineHeight: 1.45,
  },
};

type Reachability = "checking" | "live" | "offline";

function normalizePreviewUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PREVIEW_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

interface LocalhostPreviewProps {
  previewUrl?: string;
  onPreviewUrlChange?: (previewUrl: string) => void;
  active?: boolean;
}

export function LocalhostPreview({
  previewUrl: controlledPreviewUrl,
  onPreviewUrlChange,
  active = true,
}: LocalhostPreviewProps = {}) {
  const storedPreviewUrl = useWorkspaceStore((state) => state.workspaceUiState.previewUrl);
  const updateUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const previewUrl = controlledPreviewUrl ?? storedPreviewUrl;
  const [draftUrl, setDraftUrl] = useState(previewUrl);
  const [frameKey, setFrameKey] = useState(0);
  const [reachability, setReachability] = useState<Reachability>("checking");
  const [manuallyPaused, setManuallyPaused] = useState(false);

  const normalizedUrl = useMemo(() => normalizePreviewUrl(previewUrl), [previewUrl]);
  const previewActive = active && !manuallyPaused;

  useEffect(() => {
    setDraftUrl(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!previewActive) {
      setReachability("checking");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1800);
    setReachability("checking");

    fetch(normalizedUrl, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(() => setReachability("live"))
      .catch(() => setReachability("offline"))
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [previewActive, normalizedUrl, frameKey]);

  const setPreviewUrl = (url: string) => {
    const normalized = normalizePreviewUrl(url);
    setDraftUrl(normalized);
    if (onPreviewUrlChange) {
      onPreviewUrlChange(normalized);
    } else {
      updateUiState({ previewUrl: normalized });
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPreviewUrl(draftUrl);
  };

  return (
    <section style={styles.shell} aria-label="Localhost preview">
      <div style={styles.toolbar}>
        <span
          style={{
            ...styles.statusDot,
            background: reachability === "offline" ? "var(--accent-danger)" : reachability === "checking" ? "var(--accent-warning)" : "var(--accent-success)",
            boxShadow: reachability === "offline"
              ? "0 0 0 3px rgba(234, 88, 88, 0.14)"
              : reachability === "checking"
                ? "0 0 0 3px rgba(226, 181, 83, 0.14)"
                : "0 0 0 3px rgba(127, 198, 129, 0.12)",
          }}
          aria-hidden="true"
          title="Some apps may block iframe embedding with CSP or X-Frame-Options."
        />
        <form style={styles.form} onSubmit={submit}>
          <input
            style={styles.input}
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            aria-label="Preview URL"
            spellCheck={false}
          />
          <button style={styles.button} type="submit" title="Load URL" aria-label="Load preview URL">
            <ExternalLink size={14} />
          </button>
          <button
            style={styles.button}
            type="button"
            title="Reload preview"
            aria-label="Reload preview"
            onClick={() => setFrameKey((key) => key + 1)}
          >
            <RefreshCcw size={14} />
          </button>
          <button
            style={styles.button}
            type="button"
            title={manuallyPaused ? "Resume preview" : "Pause preview"}
            aria-label={manuallyPaused ? "Resume preview" : "Pause preview"}
            onClick={() => setManuallyPaused((paused) => !paused)}
            disabled={!active}
          >
            {manuallyPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </form>
        <button style={styles.quickButton} type="button" onClick={() => setPreviewUrl("http://127.0.0.1:3000")}>
          :3000
        </button>
        <button style={styles.quickButton} type="button" onClick={() => setPreviewUrl("http://127.0.0.1:5173")}>
          :5173
        </button>
        <span style={styles.statusText} aria-live="polite">
          {reachability === "checking" ? "checking" : reachability === "live" ? "live" : "offline"}
        </span>
      </div>
      <div style={styles.frameWrap}>
        {previewActive ? (
          <iframe
            key={`${normalizedUrl}:${frameKey}`}
            style={styles.iframe}
            src={normalizedUrl}
            title="Localhost preview"
            loading="lazy"
            allow="autoplay 'none'; camera 'none'; microphone 'none'"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          />
        ) : (
          <div style={styles.offlineOverlay} role="status" aria-label="Preview paused">
            <div>
              <p style={styles.offlineTitle}>Preview paused</p>
              <p style={styles.offlineDetail}>
                {active ? "Resume the preview when you are ready." : "Select this preview window to load the local site."}
              </p>
            </div>
          </div>
        )}
        {reachability === "offline" && (
          <div style={styles.offlineOverlay} role="status" aria-label="Preview server offline">
            <div>
              <p style={styles.offlineTitle}>No server is responding on this preview URL.</p>
              <p style={styles.offlineDetail}>
                Start the dev server in the linked terminal, or load a port that is actually listening.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
