// Non-security registry consistency at the existing task-launch boundary.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultChecker = resolve(dirname(fileURLToPath(import.meta.url)),
  "../../../../bots+automation/bots-directory/tools/check_bot_workflow.py");

export function hasBotPathHint(cwd) {
  let current = existsSync(cwd) ? realpathSync(cwd) : resolve(cwd);
  for (;;) {
    if (current.endsWith("/bots-directory")) return false;
    if (dirname(current).endsWith("/bots+automation")) return true;
    try {
      if (readdirSync(join(current, ".watchpost")).some((name) => /^bot.*\.json$/.test(name))) return true;
    } catch { /* no manifest directory */ }
    if (existsSync(join(current, ".git")) || dirname(current) === current) return false;
    current = dirname(current);
  }
}

export function checkBotTask({ cwd, bot, env = process.env }) {
  const checker = env.BOT_WORKFLOW_CHECKER || defaultChecker;
  const registry = env.BOT_REGISTRY_PATH || resolve(dirname(checker), "../bot-registry.yaml");
  const hinted = Boolean(bot) || hasBotPathHint(cwd);
  if (!existsSync(checker) || !existsSync(registry)) {
    if (!hinted) return null; // An unrelated project must not depend on a local fleet installation.
    throw new Error("Bot registry checker/index is missing. Restore bots-directory or set BOT_WORKFLOW_CHECKER and BOT_REGISTRY_PATH; inspect read-only until reconciled.");
  }
  const args = [checker, "--registry", registry, "--auto", "--checkout", cwd, "--json"];
  if (bot) args.push("--bot", bot);
  const result = spawnSync(env.BOT_WORKFLOW_PYTHON || "python3", args,
    { encoding: "utf8", env, timeout: 10_000, maxBuffer: 128 * 1024 });
  let record;
  try { record = JSON.parse(result.stdout); } catch { /* handled below */ }
  if (record?.status === "unavailable" && !hinted) return null;
  if (result.status !== 0 || !["valid", "unrelated"].includes(record?.status)) {
    const detail = record?.errors?.join("; ") || result.error?.message || result.stderr?.trim() || "invalid checker response";
    throw new Error(`Bot task not started: ${detail}. Reconcile the registry/path or select --bot <reference-id>; read-only inspection remains available.`);
  }
  return record.status === "valid" ? record : null;
}

export function botTaskContext(record) {
  if (!record) return "";
  return `\nBot registry reference: ${record.registry_reference}. Validated checkout: ${record.checkout}. ` +
    `Registry snapshot: ${record.registry_sha256}. Read its identity/runtime surfaces and verify current runtime before changes. ` +
    `This path check grants no deployment or messaging permission.`;
}
