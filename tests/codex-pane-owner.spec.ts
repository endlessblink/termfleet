import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper shared with the Codex status hook
import { resolveCodexPaneId } from "../scripts/lib/codex-pane-owner.mjs";

// Live 2026-09-26: newer Codex runs ONE shared background service for all chats.
// It was started from a termfleet terminal, so every chat's hook inherited that
// terminal's id: an in-control-kernel chat painted the termfleet card, and its
// own card read "Shell / No task declared".
const CHAT = "01a0c847-2f05-7570-a344-ad403394b83f";
const OTHER_CHAT = "0199aaaa-0000-7000-8000-000000000002";
const KERNEL = "/work/in-control-kernel";
const TERMFLEET = "/work/termfleet";

type Proc = { pid: number; ppid: number; args: string[]; pane?: string; tty?: string; cwd?: string };

function fakeSystem(procs: Proc[]) {
  const root = mkdtempSync(join(tmpdir(), "codex-pane-"));
  const procRoot = join(root, "proc");
  for (const proc of procs) {
    const dir = join(procRoot, String(proc.pid));
    mkdirSync(join(dir, "fd"), { recursive: true });
    writeFileSync(join(dir, "cmdline"), proc.args.join("\0") + "\0");
    writeFileSync(join(dir, "environ"), proc.pane ? `HOME=/x\0TERMFLEET_PANE_ID=${proc.pane}\0` : "HOME=/x\0");
    writeFileSync(join(dir, "stat"), `${proc.pid} (${proc.args[0]}) S ${proc.ppid} 1 1`);
    symlinkSync(proc.tty ?? "/dev/null", join(dir, "fd", "0"));
    if (proc.cwd) symlinkSync(proc.cwd, join(dir, "cwd"));
  }
  return { procRoot, bindingsPath: join(root, "codex-chat-panes.json") };
}

// The shared service, started from the termfleet terminal, and a hook it runs.
const sharedService: Proc[] = [
  { pid: 100, ppid: 1, args: ["/opt/codex", "app-server", "--managed-daemon"], pane: "pane-termfleet", cwd: TERMFLEET },
  { pid: 110, ppid: 100, args: ["/bin/sh", "-c", "hook"], pane: "pane-termfleet", cwd: KERNEL },
  { pid: 120, ppid: 110, args: ["node", "hook.mjs"], pane: "pane-termfleet", cwd: KERNEL },
];
const window = (pid: number, pane: string, cwd: string, extra: string[] = []): Proc => ({
  pid, ppid: 1, args: ["/opt/codex", ...extra], pane, tty: `/dev/pts/${pid}`, cwd,
});

test("a hook running inside the Codex window keeps that window's terminal", () => {
  const system = fakeSystem([
    window(50, "pane-kernel", KERNEL),
    { pid: 60, ppid: 50, args: ["node", "hook.mjs"], pane: "pane-kernel", cwd: KERNEL },
  ]);
  expect(
    resolveCodexPaneId({ envPaneId: "pane-kernel", conversationId: CHAT, cwd: KERNEL, selfPid: 60, ...system }),
  ).toBe("pane-kernel");
});

test("the shared service's inherited terminal is not trusted; the resumed window wins", () => {
  const system = fakeSystem([
    ...sharedService,
    window(200, "pane-termfleet", TERMFLEET),
    window(300, "pane-kernel", KERNEL, ["resume", CHAT]),
  ]);
  const pane = resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: CHAT, cwd: KERNEL, selfPid: 120, ...system });
  expect(pane).toBe("pane-kernel");
  expect(JSON.parse(readFileSync(system.bindingsPath, "utf8"))[CHAT].paneId).toBe("pane-kernel");
});

test("a fresh chat maps to the only Codex window in its folder", () => {
  const system = fakeSystem([...sharedService, window(200, "pane-termfleet", TERMFLEET), window(300, "pane-kernel", KERNEL)]);
  expect(
    resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: CHAT, cwd: `${KERNEL}/`, selfPid: 120, ...system }),
  ).toBe("pane-kernel");
});

test("two unknown windows in one folder: write nothing rather than guess", () => {
  const system = fakeSystem([...sharedService, window(300, "pane-kernel-1", KERNEL), window(301, "pane-kernel-2", KERNEL)]);
  expect(
    resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: CHAT, cwd: KERNEL, selfPid: 120, ...system }),
  ).toBe("");
});

test("a window already bound to another chat is ruled out, and a binding sticks", () => {
  const system = fakeSystem([...sharedService, window(300, "pane-kernel-1", KERNEL), window(301, "pane-kernel-2", KERNEL)]);
  writeFileSync(system.bindingsPath, JSON.stringify({ [OTHER_CHAT]: { paneId: "pane-kernel-1", at: 1 } }));
  expect(
    resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: CHAT, cwd: KERNEL, selfPid: 120, ...system }),
  ).toBe("pane-kernel-2");
  // Later events keep the remembered terminal even with no other clue.
  expect(
    resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: CHAT, cwd: "/elsewhere", selfPid: 120, ...system }),
  ).toBe("pane-kernel-2");
});

test("no chat id from the shared service: write nothing", () => {
  const system = fakeSystem([...sharedService, window(300, "pane-kernel", KERNEL)]);
  expect(
    resolveCodexPaneId({ envPaneId: "pane-termfleet", conversationId: "", cwd: KERNEL, selfPid: 120, ...system }),
  ).toBe("");
});
