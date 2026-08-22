#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "docs", "issue-registry.json");
const matrixPath = path.join(root, "docs", "issue-error-matrix.json");

const STATES = ["reported", "triaged", "reproducing", "guarded", "fixing", "verifying", "resolved", "blocked", "deferred", "wont_fix", "reopened"];
const TRANSITIONS = {
  reported: ["triaged", "deferred", "wont_fix"],
  triaged: ["reproducing", "deferred", "wont_fix"],
  reproducing: ["guarded", "blocked", "deferred"],
  guarded: ["fixing", "blocked", "deferred"],
  fixing: ["verifying", "blocked"],
  verifying: ["resolved", "fixing", "reopened", "blocked"],
  resolved: ["reopened"],
  blocked: ["triaged", "reproducing", "guarded", "fixing", "verifying", "deferred"],
  deferred: ["triaged", "reopened"],
  wont_fix: ["reopened"],
  reopened: ["triaged", "reproducing"],
};
const SEVERITIES = ["critical", "high", "medium", "low"];
const now = () => new Date().toISOString();
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const save = (value) => writeFileSync(registryPath, `${JSON.stringify(value, null, 2)}\n`);
const die = (message) => { console.error(`ISSUE SYSTEM ERROR: ${message}`); process.exitCode = 1; };
const issueFor = (registry, id) => registry.issues.find((issue) => issue.id === id);

function validate(registry, matrix) {
  const errors = [];
  if (registry.schema !== "termfleet.issue-registry.v1") errors.push("wrong registry schema");
  if (matrix.schema !== "termfleet.issue-error-matrix.v1") errors.push("wrong error matrix schema");
  const ids = new Set();
  for (const issue of registry.issues ?? []) {
    if (!issue.id || ids.has(issue.id)) errors.push(`duplicate or missing id: ${issue.id ?? "(missing)"}`);
    ids.add(issue.id);
    if (!STATES.includes(issue.state)) errors.push(`${issue.id}: unknown state ${issue.state}`);
    if (!SEVERITIES.includes(issue.severity)) errors.push(`${issue.id}: unknown severity ${issue.severity}`);
    if (!matrix.surfaces[issue.surface]) errors.push(`${issue.id}: unknown surface ${issue.surface}`);
    for (const evidence of issue.evidence ?? []) {
      const allowed = new Set(Object.values(matrix.surfaces).flatMap((surface) => surface.requiredEvidence));
      if (!allowed.has(evidence.kind)) errors.push(`${issue.id}: unknown evidence ${evidence.kind}`);
    }
    for (const field of ["title", "symptom", "nextAction", "guard", "owner"]) {
      if (!String(issue[field] ?? "").trim()) errors.push(`${issue.id}: missing ${field}`);
    }
  }
  return errors;
}

function requiredEvidence(issue, matrix) {
  return matrix.surfaces[issue.surface]?.requiredEvidence ?? [];
}

function list(registry, args) {
  const state = args.find((arg) => arg.startsWith("--state="))?.slice(8);
  const issues = registry.issues.filter((issue) => !state || issue.state === state);
  for (const issue of issues) console.log(`${issue.id}\t${issue.state}\t${issue.severity}\t${issue.surface}\t${issue.title}`);
  console.log(`TOTAL\t${issues.length}`);
}

function show(registry, matrix, id) {
  const issue = issueFor(registry, id);
  if (!issue) return die(`unknown issue ${id}`);
  console.log(JSON.stringify({ ...issue, requiredEvidence: requiredEvidence(issue, matrix) }, null, 2));
}

function transition(registry, matrix, id, target, note) {
  const issue = issueFor(registry, id);
  if (!issue) return die(`unknown issue ${id}`);
  if (!STATES.includes(target)) return die(`unknown state ${target}`);
  if (!TRANSITIONS[issue.state]?.includes(target)) return die(`${id}: cannot move from ${issue.state} to ${target}`);
  if (target === "resolved") {
    const present = new Set((issue.evidence ?? []).map((entry) => entry.kind));
    const missing = requiredEvidence(issue, matrix).filter((kind) => !present.has(kind));
    if (missing.length) return die(`${id}: cannot resolve; missing evidence: ${missing.join(", ")}`);
  }
  issue.history.push({ at: now(), type: "transition", from: issue.state, to: target, note: note || null });
  issue.state = target;
  registry.updatedAt = now();
  save(registry);
  console.log(`${id}: ${issue.history.at(-1).from} -> ${target}`);
}

function evidence(registry, matrix, id, kind, note) {
  const issue = issueFor(registry, id);
  if (!issue) return die(`unknown issue ${id}`);
  if (!requiredEvidence(issue, matrix).includes(kind)) return die(`${id}: ${kind} is not required for ${issue.surface}`);
  issue.evidence ??= [];
  issue.evidence = issue.evidence.filter((entry) => entry.kind !== kind);
  issue.evidence.push({ kind, at: now(), note: note || null });
  issue.history.push({ at: now(), type: "evidence", kind, note: note || null });
  registry.updatedAt = now();
  save(registry);
  console.log(`${id}: recorded ${kind}`);
}

function option(args, name, fallback = "") {
  const index = args.findIndex((arg) => arg === name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function create(registry, matrix, args) {
  const issue = {
    id: args[0],
    title: option(args, "--title"),
    state: "reported",
    severity: option(args, "--severity", "medium"),
    surface: option(args, "--surface"),
    matrixRefs: option(args, "--matrix", "").split(",").map((ref) => ref.trim()).filter(Boolean),
    symptom: option(args, "--symptom"),
    rootCause: option(args, "--root-cause"),
    guard: option(args, "--guard"),
    evidence: [],
    owner: option(args, "--owner", "termfleet"),
    nextAction: option(args, "--next"),
    history: [{ at: now(), type: "created", note: option(args, "--note", null) }],
  };
  if (!issue.id || issue.id.startsWith("--")) return die("create requires an issue id");
  if (issueFor(registry, issue.id)) return die(`issue already exists: ${issue.id}`);
  registry.issues.push(issue);
  const errors = validate(registry, matrix);
  if (errors.length) {
    registry.issues.pop();
    return die(errors.filter((error) => error.startsWith(`${issue.id}:`)).join("; "));
  }
  registry.updatedAt = now();
  save(registry);
  console.log(`${issue.id}: created in reported state`);
}

const [command = "help", ...args] = process.argv.slice(2);
const registry = load(registryPath);
const matrix = load(matrixPath);
if (command === "check") {
  const errors = validate(registry, matrix);
  if (errors.length) { errors.forEach((error) => console.error(`✗ ${error}`)); process.exitCode = 1; }
  else console.log(`PASS — ${registry.issues.length} issue records and ${Object.keys(matrix.surfaces).length} failure surfaces are valid.`);
} else if (command === "list") {
  list(registry, args);
} else if (command === "show") {
  show(registry, matrix, args[0]);
} else if (command === "transition") {
  const noteIndex = args.findIndex((arg) => arg === "--note");
  transition(registry, matrix, args[0], args[1], noteIndex >= 0 ? args[noteIndex + 1] : "");
} else if (command === "evidence") {
  const noteIndex = args.findIndex((arg) => arg === "--note");
  evidence(registry, matrix, args[0], args[1], noteIndex >= 0 ? args[noteIndex + 1] : "");
} else if (command === "create") {
  create(registry, matrix, args);
} else {
  console.log("Usage: termfleet-issues.mjs check|list [--state=STATE]|show ID|create ID --title TITLE --surface SURFACE --symptom SYMPTOM --guard GUARD --next NEXT|transition ID STATE [--note NOTE]|evidence ID KIND [--note NOTE]");
}
