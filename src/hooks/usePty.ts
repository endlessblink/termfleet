import { useCallback, useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { IDisposable, Terminal } from "@xterm/xterm";
import {
  createDaemonInputQueue,
  nextTerminalInputSequence,
  type DaemonInputQueue,
} from "../lib/daemonInputQueue";
import { traceTerminalLatency } from "../lib/terminalLatencyTrace";
import type { TerminalRuntimeStatus } from "../lib/types";

interface UsePtyOptions {
  terminal: Terminal | null;
  cwd?: string;
  command?: string;
  attachToPtyId?: string | null;
  runtimeSessionId?: string;
  onReady?: (id: string, details: { reused: boolean }) => void;
  onStatus?: (status: TerminalRuntimeStatus, details?: { id?: string; error?: string }) => void;
  onOutput?: (data: string) => void;
  onExit?: (details: { id: string; code: number; success: boolean }) => void;
}

interface BrowserPtySession {
  cwd: string;
  subscribers: Set<Terminal>;
  outputSubscribers: Set<(data: string) => void>;
  exitSubscribers: Set<(details: { id: string; code: number; success: boolean }) => void>;
  input: string;
  output: string;
  exited?: boolean;
  exitCode?: number;
}

interface PtyEnsureResult {
  id: string;
  reused: boolean;
}

interface DaemonStatus {
  reachable: boolean;
  mode: "embeddedFallback" | "externalDaemon";
}

interface PtyStreamEvent {
  data: string;
  snapshot: boolean;
}

type PtyTransport = "browser" | "tauri" | "daemon";

const browserPtys = new Map<string, BrowserPtySession>();
const ptyOutputBuffers = new Map<string, string>();
const MAX_REPLAY_BUFFER = 200_000;
const TRACE_PTY =
  typeof window !== "undefined" && window.localStorage?.getItem("terminal-workspace.tracePty") === "1";
type ActiveInputListener = {
  transport: PtyTransport;
  sessionHint: string;
  dispose?: () => void;
};
const activeInputListeners = new Map<string, ActiveInputListener>();

function syncInputListenerDebugState() {
  if (typeof window === "undefined") return;
  (window as typeof window & {
    __terminalWorkspaceInputListeners?: Record<string, { transport: PtyTransport; sessionHint: string }>;
  }).__terminalWorkspaceInputListeners = Object.fromEntries(
    Array.from(activeInputListeners.entries()).map(([listenerId, listener]) => [
      listenerId,
      {
        transport: listener.transport,
        sessionHint: listener.sessionHint,
      },
    ])
  );
}

function markInputListenerActive(
  listenerId: string,
  transport: PtyTransport,
  sessionHint: string,
  dispose?: () => void
) {
  for (const [previousListenerId, previous] of activeInputListeners) {
    if (previousListenerId === listenerId || previous.sessionHint !== sessionHint) continue;
    activeInputListeners.delete(previousListenerId);
    try {
      previous.dispose?.();
    } catch (error) {
      console.warn("Failed to dispose stale terminal input listener", error);
    }
    traceTerminalLatency("frontend.xterm.onData.listener.replaced", {
      listenerId: previousListenerId,
      replacementListenerId: listenerId,
      transport: previous.transport,
      sessionHint: previous.sessionHint,
      activeInputListeners: activeInputListeners.size,
    });
  }

  activeInputListeners.set(listenerId, { transport, sessionHint, dispose });
  syncInputListenerDebugState();
  traceTerminalLatency("frontend.xterm.onData.listener.active", {
    listenerId,
    transport,
    sessionHint,
    activeInputListeners: activeInputListeners.size,
  });
}

function markInputListenerInactive(listenerId: string) {
  const previous = activeInputListeners.get(listenerId);
  activeInputListeners.delete(listenerId);
  syncInputListenerDebugState();
  traceTerminalLatency("frontend.xterm.onData.listener.inactive", {
    listenerId,
    transport: previous?.transport,
    sessionHint: previous?.sessionHint,
    activeInputListeners: activeInputListeners.size,
  });
}

function tracePty(label: string, details: Record<string, unknown> = {}) {
  if (!TRACE_PTY) return;
  const event = {
    t: performance.now(),
    label,
    ...details,
  };
  const debugWindow = window as typeof window & {
    __terminalWorkspacePtyTrace?: Array<Record<string, unknown>>;
  };
  debugWindow.__terminalWorkspacePtyTrace ??= [];
  debugWindow.__terminalWorkspacePtyTrace.push(event);
  console.debug("[TW-PTY]", event);
}

function syncBrowserPtyDebugState() {
  if (isTauriRuntime()) return;
  (window as typeof window & {
    __terminalWorkspaceBrowserPtys?: Record<string, { cwd: string; input: string; output: string; subscribers: number }>;
  }).__terminalWorkspaceBrowserPtys = Object.fromEntries(
    Array.from(browserPtys.entries()).map(([id, session]) => [
      id,
      {
        cwd: session.cwd,
        input: session.input,
        output: session.output,
        subscribers: session.subscribers.size,
      },
    ])
  );
}

function appendPtyOutput(id: string, data: string) {
  const current = ptyOutputBuffers.get(id) ?? "";
  const next = current + data;
  ptyOutputBuffers.set(
    id,
    next.length > MAX_REPLAY_BUFFER ? next.slice(next.length - MAX_REPLAY_BUFFER) : next
  );
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function browserPrompt(_cwd: string) {
  return "\x1b[38;5;214mweb\x1b[0m$ ";
}

function broadcastBrowserPty(id: string, data: string) {
  const session = browserPtys.get(id);
  if (!session) return;
  session.output += data;
  if (session.output.length > MAX_REPLAY_BUFFER) {
    session.output = session.output.slice(session.output.length - MAX_REPLAY_BUFFER);
  }
  appendPtyOutput(id, data);
  session.subscribers.forEach((subscriber) => subscriber.write(data));
  session.outputSubscribers.forEach((subscriber) => subscriber(data));
  syncBrowserPtyDebugState();
}

function broadcastBrowserExit(id: string, code: number) {
  const session = browserPtys.get(id);
  if (!session || session.exited) return;
  session.exited = true;
  session.exitCode = code;
  const success = code === 0;
  const line = `process exited with code ${code}\r\n`;
  broadcastBrowserPty(id, line);
  session.exitSubscribers.forEach((subscriber) => subscriber({ id, code, success }));
  syncBrowserPtyDebugState();
}

function browserList(cwd: string) {
  if (cwd.endsWith("/src")) return "components  hooks  stores  styles  main.tsx\r\n";
  if (cwd.endsWith("/docs")) return "terminal-cockpit-design-contract.md  visual-baselines\r\n";
  return "src  src-tauri  docs  package.json  README.md  MASTER_PLAN.md\r\n";
}

function runBrowserCommand(id: string, command: string) {
  const session = browserPtys.get(id);
  if (!session) return;

  const trimmed = command.trim();
  if (!trimmed) {
    broadcastBrowserPty(id, browserPrompt(session.cwd));
    return;
  }

  if (trimmed === "clear") {
    broadcastBrowserPty(id, "\x1bc" + browserPrompt(session.cwd));
    return;
  }

  if (trimmed === "help") {
    broadcastBrowserPty(
      id,
      [
        "Browser test shell commands:",
        "  help          show this command list",
        "  pwd           print the current demo directory",
        "  ls            list demo workspace entries",
        "  cd <path>     change demo directory",
        "  echo <text>   print text",
        "  date          print browser date",
        "  whoami        print runtime identity",
        "",
      ].join("\r\n")
    );
    broadcastBrowserPty(id, browserPrompt(session.cwd));
    return;
  }

  if (trimmed === "pwd") {
    broadcastBrowserPty(id, `${session.cwd}\r\n${browserPrompt(session.cwd)}`);
    return;
  }

  if (trimmed === "ls" || trimmed.startsWith("ls ")) {
    broadcastBrowserPty(id, `${browserList(session.cwd)}${browserPrompt(session.cwd)}`);
    return;
  }

  if (trimmed.startsWith("cd")) {
    const target = trimmed.slice(2).trim();
    if (!target || target === "~") {
      session.cwd = "/browser-workspace";
    } else if (target === "..") {
      const parts = session.cwd.split("/").filter(Boolean);
      session.cwd = parts.length <= 1 ? "/" : `/${parts.slice(0, -1).join("/")}`;
    } else if (target.startsWith("/")) {
      session.cwd = target;
    } else {
      session.cwd = `${session.cwd.replace(/\/$/, "")}/${target}`;
    }
    broadcastBrowserPty(id, browserPrompt(session.cwd));
    return;
  }

  if (trimmed.startsWith("echo ")) {
    broadcastBrowserPty(id, `${trimmed.slice(5)}\r\n${browserPrompt(session.cwd)}`);
    return;
  }

  if (trimmed === "exit" || /^exit\s+-?\d+$/.test(trimmed)) {
    const rawCode = trimmed === "exit" ? 0 : Number(trimmed.split(/\s+/)[1]);
    const code = Number.isInteger(rawCode) ? rawCode : 0;
    broadcastBrowserExit(id, code);
    return;
  }

  if (trimmed === "date") {
    broadcastBrowserPty(id, `${new Date().toString()}\r\n${browserPrompt(session.cwd)}`);
    return;
  }

  if (trimmed === "whoami") {
    broadcastBrowserPty(id, `browser-preview\r\n${browserPrompt(session.cwd)}`);
    return;
  }

  broadcastBrowserPty(
    id,
    `${trimmed}: command is not available in browser preview. Use the Tauri app for real shell commands.\r\n${browserPrompt(session.cwd)}`
  );
}

function writeBrowserPty(id: string, data: string) {
  const session = browserPtys.get(id);
  if (!session) return;
  if (session.exited) return;

  for (const char of data) {
    if (char === "\r") {
      const command = session.input;
      session.input = "";
      broadcastBrowserPty(id, "\r\n");
      runBrowserCommand(id, command);
      continue;
    }

    if (char === "\u007f") {
      if (session.input.length > 0) {
        session.input = session.input.slice(0, -1);
        broadcastBrowserPty(id, "\b \b");
      }
      continue;
    }

    if (char === "\u0003") {
      session.input = "";
      broadcastBrowserPty(id, "^C\r\n" + browserPrompt(session.cwd));
      continue;
    }

    if (char === "\u000c") {
      broadcastBrowserPty(id, "\x1bc" + browserPrompt(session.cwd) + session.input);
      continue;
    }

    if (char >= " " && char !== "\u007f") {
      session.input += char;
      broadcastBrowserPty(id, char);
    }
  }
}

export function destroyBrowserPtys(ids: string[]) {
  if (typeof window === "undefined" || isTauriRuntime()) return;

  ids.forEach((id) => {
    browserPtys.delete(id);
    ptyOutputBuffers.delete(id);
  });
  syncBrowserPtyDebugState();
}

export function writeBrowserPtys(ids: string[], data: string) {
  if (typeof window === "undefined" || isTauriRuntime()) return;

  ids.forEach((id) => writeBrowserPty(id, data));
  syncBrowserPtyDebugState();
}

export function usePty({ terminal, cwd, command, attachToPtyId, runtimeSessionId, onReady, onStatus, onOutput, onExit }: UsePtyOptions) {
  const ptyIdRef = useRef<string | null>(null);
  const ownsPtyRef = useRef(false);
  const transportRef = useRef<PtyTransport | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const dataDisposableRef = useRef<IDisposable | null>(null);
  const daemonOutputChannelRef = useRef<Channel<PtyStreamEvent> | null>(null);
  const daemonSubscriberIdRef = useRef(`terminal-view-${crypto.randomUUID()}`);
  const inputListenerIdRef = useRef(`terminal-input-${crypto.randomUUID()}`);
  const inputListenerActiveRef = useRef(false);
  const daemonInputQueueRef = useRef<DaemonInputQueue | null>(null);
  const daemonPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transportFailedRef = useRef(false);

  const activateInputListener = useCallback((transport: PtyTransport, sessionHint: string) => {
    if (inputListenerActiveRef.current) {
      markInputListenerInactive(inputListenerIdRef.current);
    }
    inputListenerActiveRef.current = true;
    markInputListenerActive(inputListenerIdRef.current, transport, sessionHint, () => {
      dataDisposableRef.current?.dispose();
      dataDisposableRef.current = null;
    });
  }, []);

  const disposeInputListener = useCallback(() => {
    dataDisposableRef.current?.dispose();
    dataDisposableRef.current = null;
    if (!inputListenerActiveRef.current) return;
    inputListenerActiveRef.current = false;
    markInputListenerInactive(inputListenerIdRef.current);
  }, []);

  // Spawn PTY and wire up data flow
  useEffect(() => {
    if (!terminal) return;

    let cancelled = false;

    const stopBrokenTransport = (error: unknown, operation: "read" | "write") => {
      if (transportFailedRef.current) return;

      transportFailedRef.current = true;
      const id = ptyIdRef.current ?? attachToPtyId ?? runtimeSessionId ?? undefined;
      console.error(`PTY ${operation} transport failed:`, error);
      onStatus?.("failed", { id, error: String(error) });

      disposeInputListener();
      daemonOutputChannelRef.current = null;
      unlistenRef.current?.();
      unlistenRef.current = null;
      if (ptyIdRef.current && transportRef.current === "daemon") {
        invoke("daemon_unsubscribe_session", {
          id: ptyIdRef.current,
          subscriberId: daemonSubscriberIdRef.current,
        }).catch(console.error);
      }
      if (daemonPollTimeoutRef.current) {
        clearTimeout(daemonPollTimeoutRef.current);
        daemonPollTimeoutRef.current = null;
      }
      ptyIdRef.current = null;
      transportRef.current = null;
    };

    async function setup() {
      try {
        transportFailedRef.current = false;
        const startingId = attachToPtyId ?? runtimeSessionId;
        onStatus?.("starting", { id: startingId ?? undefined });

        if (!isTauriRuntime()) {
          transportRef.current = "browser";
          let id = attachToPtyId ?? runtimeSessionId ?? crypto.randomUUID();
          let shouldAttachBrowser = Boolean(attachToPtyId);
          let session = browserPtys.get(id);
          if (attachToPtyId && !session) {
            onStatus?.("stale", { id: attachToPtyId });
            if (!runtimeSessionId) {
              terminal!.write("[linked terminal session is not available]\r\n");
              return;
            }
            id = runtimeSessionId;
            shouldAttachBrowser = false;
            session = browserPtys.get(id);
          }
          if (!session) {
            session = {
              cwd: cwd ?? "/browser-workspace",
              subscribers: new Set(),
              outputSubscribers: new Set(),
              exitSubscribers: new Set(),
              input: "",
              output: "",
            };
            browserPtys.set(id, session);
            syncBrowserPtyDebugState();
          }

          ownsPtyRef.current = !shouldAttachBrowser;
          ptyIdRef.current = id;
          session.subscribers.add(terminal!);
          if (onOutput) session.outputSubscribers.add(onOutput);
          if (onExit) session.exitSubscribers.add(onExit);
          syncBrowserPtyDebugState();

          dataDisposableRef.current = terminal!.onData((data: string) => {
            const seqId = nextTerminalInputSequence();
            traceTerminalLatency("frontend.xterm.onData", {
              id: ptyIdRef.current,
              bytes: data.length,
              seqId,
              transport: "browser",
              activeInputListeners: activeInputListeners.size,
              data,
            });
            if (ptyIdRef.current) writeBrowserPty(ptyIdRef.current, data);
          });
          activateInputListener("browser", id);

          onStatus?.(session.exited ? "exited" : shouldAttachBrowser ? "reconnected" : "running", { id });
          onReady?.(id, { reused: shouldAttachBrowser });
          if (session.exited && typeof session.exitCode === "number") {
            onExit?.({ id, code: session.exitCode, success: session.exitCode === 0 });
          }
          window.setTimeout(() => {
            if (cancelled || ptyIdRef.current !== id) return;
            if (shouldAttachBrowser) {
              const replay = session.output || ptyOutputBuffers.get(id) || "";
              if (replay) onOutput?.(replay);
              terminal!.write(replay);
              return;
            }
            const intro =
              "Browser preview shell. Type `help` for supported commands.\r\n" +
              "Use the standalone Tauri app for real system PTYs.\r\n\r\n" +
              browserPrompt(session.cwd);
            onOutput?.(intro);
            broadcastBrowserPty(id, intro);
            if (command) {
              writeBrowserPty(id, command);
              writeBrowserPty(id, "\r");
            }
          }, 180);
          return;
        }

        let id = attachToPtyId ?? runtimeSessionId ?? crypto.randomUUID();
        const pendingWrites: string[] = [];
        const daemonStatus = await invoke<DaemonStatus>("daemon_ensure_running").catch(() => null);
        const useDaemon = daemonStatus?.reachable && daemonStatus.mode === "externalDaemon";

        if (useDaemon) {
          try {
            transportRef.current = "daemon";
            ownsPtyRef.current = !attachToPtyId;
            const daemonInputQueue = createDaemonInputQueue({
              getId: () => ptyIdRef.current,
              source: "xterm-onData",
              tracePty,
              onFallbackError: (fallbackError) => {
                stopBrokenTransport(fallbackError, "write");
              },
            });
            daemonInputQueueRef.current = daemonInputQueue;

            const queueDaemonInput = (data: string, seqId: number) => {
              tracePty("frontend.xterm.onData", {
                id: ptyIdRef.current,
                bytes: data.length,
                seqId,
                data,
              });
              traceTerminalLatency("frontend.xterm.onData", {
                id: ptyIdRef.current,
                bytes: data.length,
                seqId,
                activeInputListeners: activeInputListeners.size,
                data,
              });
              daemonInputQueue.queue(data, seqId);
            };

            dataDisposableRef.current = terminal!.onData((data: string) => {
              const seqId = nextTerminalInputSequence();
              if (ptyIdRef.current) {
                queueDaemonInput(data, seqId);
              } else if (!transportFailedRef.current) {
                traceTerminalLatency("frontend.xterm.onData.pending", {
                  seqId,
                  bytes: data.length,
                  activeInputListeners: activeInputListeners.size,
                });
                pendingWrites.push(data);
              }
            });
            activateInputListener("daemon", id);

            const ensured = await invoke<PtyEnsureResult>("daemon_ensure_session", {
              id,
              cwd: cwd ?? null,
              command: command ?? null,
            });

            if (cancelled) {
              return;
            }

            const spawnedId = ensured.id;
            ptyIdRef.current = spawnedId;
            const outputChannel = new Channel<PtyStreamEvent>((event) => {
              if (cancelled || ptyIdRef.current !== spawnedId || transportRef.current !== "daemon") return;
              if (!event.data) return;
              tracePty("frontend.daemon.channel.data", {
                id: spawnedId,
                bytes: event.data.length,
                snapshot: event.snapshot,
                data: event.data,
              });
              traceTerminalLatency("frontend.daemon.channel.data", {
                id: spawnedId,
                bytes: event.data.length,
                snapshot: event.snapshot,
                data: event.data,
              });
              appendPtyOutput(spawnedId, event.data);
              onOutput?.(event.data);
              tracePty("frontend.xterm.write.called", {
                id: spawnedId,
                bytes: event.data.length,
              });
              traceTerminalLatency("frontend.xterm.write.call", {
                id: spawnedId,
                bytes: event.data.length,
              });
              terminal!.write(event.data, () => {
                traceTerminalLatency("frontend.xterm.write.callback", {
                  id: spawnedId,
                  bytes: event.data.length,
                });
                requestAnimationFrame(() => {
                  traceTerminalLatency("frontend.xterm.write.raf", {
                    id: spawnedId,
                    bytes: event.data.length,
                  });
                });
              });
            });
            daemonOutputChannelRef.current = outputChannel;

            onStatus?.(ensured.reused ? "reconnected" : "running", { id: spawnedId });
            onReady?.(spawnedId, { reused: ensured.reused });
            await invoke("daemon_subscribe_session", {
              id: spawnedId,
              subscriberId: daemonSubscriberIdRef.current,
              onData: outputChannel,
            });
            traceTerminalLatency("frontend.daemon.subscribe.done", {
              id: spawnedId,
              subscriberId: daemonSubscriberIdRef.current,
              activeInputListeners: activeInputListeners.size,
            });

            for (const data of pendingWrites.splice(0)) {
              daemonInputQueue.queue(data);
            }
            daemonInputQueue.flush();

            return;
          } catch (daemonError) {
            console.warn("Daemon PTY transport failed; falling back to embedded Tauri PTY:", daemonError);
            disposeInputListener();
            daemonInputQueueRef.current?.dispose();
            daemonInputQueueRef.current = null;
            daemonOutputChannelRef.current = null;
            if (daemonPollTimeoutRef.current) {
              clearTimeout(daemonPollTimeoutRef.current);
              daemonPollTimeoutRef.current = null;
            }
            ptyIdRef.current = null;
            ownsPtyRef.current = false;
            transportRef.current = null;
          }
        }

        transportRef.current = "tauri";
        let shouldAttach = Boolean(attachToPtyId);
        if (attachToPtyId) {
          try {
            await invoke("pty_get_cwd", { id: attachToPtyId });
          } catch {
            onStatus?.("stale", { id: attachToPtyId });
            shouldAttach = false;
            id = runtimeSessionId ?? crypto.randomUUID();
          }
        }
        ownsPtyRef.current = !shouldAttach;

        const unlisten = await listen<string>(`pty-data-${id}`, (event) => {
          if (ownsPtyRef.current) appendPtyOutput(id, event.payload);
          onOutput?.(event.payload);
          terminal!.write(event.payload);
        });
        unlistenRef.current = unlisten;

        dataDisposableRef.current = terminal!.onData((data: string) => {
          const seqId = nextTerminalInputSequence();
          traceTerminalLatency("frontend.xterm.onData", {
            id: ptyIdRef.current,
            bytes: data.length,
            seqId,
            transport: "tauri",
            activeInputListeners: activeInputListeners.size,
            data,
          });
          if (ptyIdRef.current) {
            invoke("pty_write", { id: ptyIdRef.current, data }).catch(
              (writeError) => {
                stopBrokenTransport(writeError, "write");
              }
            );
          } else if (!transportFailedRef.current) {
            pendingWrites.push(data);
          }
        });
        activateInputListener("tauri", id);

        if (shouldAttach) {
          ptyIdRef.current = id;
          const replay = await invoke<string>("pty_snapshot", { id }).catch(() => ptyOutputBuffers.get(id) ?? "");
          if (replay) terminal!.write(replay);
          onStatus?.("reconnected", { id });
          onReady?.(id, { reused: true });
          return;
        }

        const ensured = await invoke<PtyEnsureResult>("pty_ensure", {
          id,
          cwd: cwd ?? null,
          command: command ?? null,
        });

        if (cancelled) {
          return;
        }

        const spawnedId = ensured.id;
        ptyIdRef.current = spawnedId;
        if (ensured.reused) {
          const replay = await invoke<string>("pty_snapshot", { id: spawnedId }).catch(() => "");
          if (replay) terminal!.write(replay);
        }
        onStatus?.(ensured.reused ? "reconnected" : "running", { id: spawnedId });
        onReady?.(spawnedId, { reused: ensured.reused });
        for (const data of pendingWrites.splice(0)) {
          await invoke("pty_write", { id: spawnedId, data }).catch(
            (writeError) => {
              stopBrokenTransport(writeError, "write");
            }
          );
        }
      } catch (err) {
        console.error("Failed to spawn PTY:", err);
        const error = String(err);
        onStatus?.("failed", { id: attachToPtyId ?? runtimeSessionId ?? undefined, error });
        terminal!.write(`\r\n[pty spawn failed] ${error}\r\n`);
      }
    }

    setup();

    return () => {
      cancelled = true;
      disposeInputListener();
      daemonInputQueueRef.current?.dispose();
      daemonInputQueueRef.current = null;
      daemonOutputChannelRef.current = null;
      unlistenRef.current?.();
      unlistenRef.current = null;
      if (daemonPollTimeoutRef.current) {
        clearTimeout(daemonPollTimeoutRef.current);
        daemonPollTimeoutRef.current = null;
      }
      if (ptyIdRef.current && transportRef.current === "daemon") {
        invoke("daemon_unsubscribe_session", {
          id: ptyIdRef.current,
          subscriberId: daemonSubscriberIdRef.current,
        }).catch(console.error);
      }
      if (ptyIdRef.current && !isTauriRuntime()) {
        const session = browserPtys.get(ptyIdRef.current);
        session?.subscribers.delete(terminal);
        if (onOutput) session?.outputSubscribers.delete(onOutput);
        if (onExit) session?.exitSubscribers.delete(onExit);
        syncBrowserPtyDebugState();
      }
      ptyIdRef.current = null;
      ownsPtyRef.current = false;
      transportRef.current = null;
      transportFailedRef.current = false;
    };
  }, [terminal, cwd, command, attachToPtyId, runtimeSessionId, onReady, onStatus, onOutput, onExit, activateInputListener, disposeInputListener]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize handler
  const resize = useCallback((cols: number, rows: number) => {
    if (!isTauriRuntime()) return;
    if (ptyIdRef.current) {
      invoke(transportRef.current === "daemon" ? "daemon_resize_session" : "pty_resize", { id: ptyIdRef.current, cols, rows }).catch(
        console.error
      );
    }
  }, []);

  const write = useCallback((data: string) => {
    if (!ptyIdRef.current || transportFailedRef.current) return;
    if (!isTauriRuntime()) {
      writeBrowserPty(ptyIdRef.current, data);
      return;
    }
    if (transportRef.current === "daemon") {
      const seqId = nextTerminalInputSequence();
      let queue = daemonInputQueueRef.current;
      if (!queue) {
        queue = createDaemonInputQueue({
          getId: () => ptyIdRef.current,
          source: "imperative-write",
          onFallbackError: console.error,
        });
        daemonInputQueueRef.current = queue;
      }
      queue.queue(data, seqId);
      return;
    }
    invoke("pty_write", { id: ptyIdRef.current, data }).catch(console.error);
  }, []);

  return { ptyId: ptyIdRef.current, resize, write };
}
