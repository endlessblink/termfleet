import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper shared with the status hooks
import { closeOtherCopies, findOtherCopies } from "../scripts/lib/single-chat-owner.mjs";

// Live 2026-09-24: one Claude chat ran in three terminals at once, each reopened by
// hand because the older copy looked stuck. Opening a chat now closes older copies
// in OTHER TermFleet terminals, and nothing else.
const CHAT = "3f16bc7a-0000-4000-8000-000000000001";

type Proc = { pid: number; ppid: number; args: string[]; pane?: string; tty?: string; fds?: string[] };

function fakeSystem(procs: Proc[], sessions: Record<number, string>) {
  const root = mkdtempSync(join(tmpdir(), "single-chat-"));
  const procRoot = join(root, "proc");
  const claudeSessionsDir = join(root, "sessions");
  mkdirSync(claudeSessionsDir, { recursive: true });
  for (const proc of procs) {
    const dir = join(procRoot, String(proc.pid));
    mkdirSync(join(dir, "fd"), { recursive: true });
    writeFileSync(join(dir, "cmdline"), proc.args.join("\0") + "\0");
    writeFileSync(join(dir, "environ"), proc.pane ? `HOME=/x\0TERMFLEET_PANE_ID=${proc.pane}\0` : "HOME=/x\0");
    writeFileSync(join(dir, "stat"), `${proc.pid} (${proc.args[0]}) S ${proc.ppid} 1 1`);
    if (proc.tty) symlinkSync(proc.tty, join(dir, "fd", "0"));
    (proc.fds ?? []).forEach((target, index) => symlinkSync(target, join(dir, "fd", String(index + 3))));
  }
  for (const [pid, sessionId] of Object.entries(sessions)) {
    writeFileSync(join(claudeSessionsDir, `${pid}.json`), JSON.stringify({ pid: Number(pid), sessionId }));
  }
  return { procRoot, claudeSessionsDir };
}

const claude = (pid: number, pane: string | undefined, tty?: string): Proc => ({
  pid, ppid: 1, args: ["claude"], pane, tty,
});

test("opening a chat closes its older copy in another terminal, and only that", () => {
  const system = fakeSystem(
    [
      claude(50, "pane-A", "/dev/pts/3"), // the copy the operator is typing into
      { pid: 60, ppid: 50, args: ["/bin/sh", "-c", "hook"], pane: "pane-A" },
      { pid: 70, ppid: 60, args: ["node", "hook.mjs"], pane: "pane-A" },
      claude(200, "pane-B", "/dev/pts/5"), // older copy of the same chat → closed
      claude(300, "pane-C", "/dev/pts/6"), // a different chat → untouched
      claude(400, "pane-D"), // headless run of the same chat → untouched
      claude(500, undefined, "/dev/pts/7"), // same chat outside TermFleet → untouched
      claude(600, "pane-A", "/dev/pts/3"), // same terminal → untouched
    ],
    { 50: CHAT, 200: CHAT, 300: "another-chat", 400: CHAT, 500: CHAT, 600: CHAT },
  );
  const killed: Array<[number, string]> = [];
  const notes: string[] = [];
  const closed = closeOtherCopies(
    { provider: "claude", conversationId: CHAT, paneId: "pane-A", selfPid: 70, ...system },
    { kill: (pid: number, signal: string) => killed.push([pid, signal]), waitMs: 0, writeNote: (t: string) => notes.push(t) },
  );
  expect(closed.map((copy: { pid: number }) => copy.pid)).toEqual([200]);
  expect(killed).toEqual([[200, "SIGTERM"]]);
  expect(notes).toEqual(["/dev/pts/5"]);
});

test("a scripted run of a chat never closes the operator's copy", () => {
  const system = fakeSystem(
    [
      claude(50, "pane-A"), // no terminal: a headless run
      { pid: 70, ppid: 50, args: ["node", "hook.mjs"], pane: "pane-A" },
      claude(200, "pane-B", "/dev/pts/5"),
    ],
    { 50: CHAT, 200: CHAT },
  );
  expect(
    findOtherCopies({ provider: "claude", conversationId: CHAT, paneId: "pane-A", selfPid: 70, ...system }),
  ).toEqual([]);
});

test("Codex copies are matched by the chat file they hold open", () => {
  const codexBin = "/opt/codex/vendor/bin/codex";
  const file = (id: string) => `/home/x/.codex/sessions/2026/09/24/rollout-2026-09-24T10-00-00-${id}.jsonl`;
  const system = fakeSystem(
    [
      { pid: 50, ppid: 1, args: [codexBin, "resume", CHAT], pane: "pane-A", tty: "/dev/pts/3", fds: [file(CHAT)] },
      { pid: 70, ppid: 50, args: ["node", "hook.mjs"], pane: "pane-A" },
      { pid: 199, ppid: 1, args: ["node", "/home/x/bin/codex", "resume"], pane: "pane-B", tty: "/dev/pts/5" },
      { pid: 200, ppid: 199, args: [codexBin, "resume"], pane: "pane-B", tty: "/dev/pts/5", fds: [file(CHAT)] },
      { pid: 300, ppid: 1, args: [codexBin], pane: "pane-C", tty: "/dev/pts/6", fds: [file("other-chat")] },
    ],
    {},
  );
  const copies = findOtherCopies({ provider: "codex", conversationId: CHAT, paneId: "pane-A", selfPid: 70, ...system });
  expect(copies.map((copy: { pid: number }) => copy.pid)).toEqual([200]);
});

test("without a chat id or a TermFleet terminal nothing is touched", () => {
  const system = fakeSystem([claude(200, "pane-B", "/dev/pts/5")], { 200: CHAT });
  expect(findOtherCopies({ provider: "claude", conversationId: "", paneId: "pane-A", selfPid: 70, ...system })).toEqual([]);
  expect(findOtherCopies({ provider: "claude", conversationId: CHAT, paneId: "", selfPid: 70, ...system })).toEqual([]);
});
