// Task-based model router for Claude helpers (Noam 2026-10-24: "לא רוצה הארדקודינג!!!",
// "זה תלוי משימה...", "זה צריך להיות ראוטר אמיתי, מדויק ואמין!").
//
// Picks the cheapest Claude model that can do the job, from the task text alone, with
// deterministic keyword/pattern rules (no model call, same text -> same answer):
//   haiku  - searches only: find, locate, look up, where is (Noam 2026-10-26: "haiku should be
//            used only for searches"; Haiku helpers given status/check jobs ended up editing files)
//   sonnet - ordinary changes: code edits, bug fixes, builds, tests (also the fallback)
//   opus   - hard jobs: architecture, multi-file refactors, planning, design, cross-file debugging
//
// Cheap only when clearly safe: any sign of a change lifts haiku to sonnet, and a strong sign
// of a hard job (or a big, many-file brief) lifts it to opus.

// [pattern, weight]. Weight 2 = decisive on its own, 1 = needs company.
const COMPLEX = [
  [/\b(re-?)?architect(ure|ural)?\b/i, 2],
  [/\b(system|software|api|schema|data[- ]model)\s+design\b/i, 2],
  [/\bdesign (a|an|the)\s+(new\s+)?(system|architecture|protocol|pipeline|api|schema|data model|router|engine)\b/i, 2],
  [/\brefactor\w*\b[^.\n]{0,60}\b(across|multiple|several|many|all|whole|entire|codebase|modules|files)\b/i, 2],
  [/\b(multi|cross)[- ]?(file|module|package|repo|component)s?\b/i, 2],
  [/\b(across|in) (multiple|several|many|all) (files|modules|packages|components|services|repos)\b/i, 2],
  [/\b(whole|entire) (codebase|repo|repository|app|system)\b/i, 2],
  [/\broot[- ]cause\b/i, 2],
  [/\bdebug\w*\b[^.\n]{0,60}\b(across|between|end[- ]to[- ]end|race|intermittent|flaky|deadlock|leak)\b/i, 2],
  [/\b(race condition|deadlock|memory leak|heisenbug)\b/i, 2],
  [/\b(implementation|migration|rollout|release|project|technical) plan\b/i, 2],
  [/\b(write|make|draft|create) (a|an|the) plan\b/i, 2],
  [/\b(security|threat) (audit|review|model)\b/i, 2],
  [/\b(audit|review) (the )?(whole|entire|codebase|architecture)\b/i, 2],
  [/ארכיטקטור|תכנון|תכנן|עיצוב מערכת|ריפקטור|שכתוב|מיגרציה|חקור|שורש הבעיה/, 2],
  [/\bplan (out|the|how)\b/i, 1],
  [/\bmigrat(e|ion)\b/i, 1],
  [/\brewrite\b/i, 1],
  [/\brefactor\w*\b/i, 1],
  [/\b(re)?design\b/i, 1],
  [/\b(investigate|diagnose)\b/i, 1],
  [/\b(trade-?offs?|strategy|strategic)\b/i, 1],
  [/\bend[- ]to[- ]end\b/i, 1],
  [/\bfrom scratch\b/i, 1],
];

const STANDARD = [
  [/\b(fix|fixes|fixing|patch|repair)\b/i, 1],
  [/\bbug\b/i, 1],
  [/\b(implement|add|create|build|write|edit|change|modify|update|rename|remove|delete|replace|wire|hook up|port|convert|bump|upgrade|install|configure|commit|push|deploy|release)\b/i, 1],
  [/\b(tests?|unit test|spec|lint|typecheck|compile)\b/i, 1],
  [/\.(m?[jt]sx?|rs|py|go|rb|css|html|json|toml|ya?ml|sh)\b/i, 1],
  [/תקן|תוסיף|הוסף|תבנה|בנה|שנה|תשנה|תעדכן|עדכן|תמחק|מחק|תכתוב|כתוב|באג/, 1],
];

const SEARCH = [
  [/\b(find|search( for)?|locate|look up|lookup|grep|where (is|are|does|do)|which (file|files|folder|line))\b/i, 1],
  [/חפש|תחפש|תמצא|מצא|איפה/, 1],
];

function score(text, rules) {
  const hits = [];
  let total = 0;
  for (const [pattern, weight] of rules) {
    const match = text.match(pattern);
    if (match) {
      total += weight;
      hits.push(match[0].trim());
    }
  }
  return { total, hits };
}

// Size signals: a long brief or one naming many files is a big job whatever its words say.
function sizeSignals(text) {
  const reasons = [];
  let bonus = 0;
  const files = new Set(text.match(/[\w./-]+\.(?:m?[jt]sx?|rs|py|go|rb|css|html|toml|ya?ml|sh)\b/gi) ?? []);
  if (files.size >= 4) { bonus += 2; reasons.push(`${files.size} files named`); }
  const steps = (text.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) ?? []).length;
  if (steps >= 8) { bonus += steps >= 12 ? 2 : 1; reasons.push(`${steps} listed steps`); }
  if (text.length >= 4000) { bonus += 1; reasons.push(`${text.length} characters long`); }
  return { bonus, reasons };
}

/** Full decision with the reasons behind it (for logs and tests). */
export function explainTaskRoute(taskText) {
  const text = String(taskText ?? "").trim();
  if (!text) return { model: "sonnet", reasons: ["empty task: standard default"] };
  const complex = score(text, COMPLEX);
  const size = sizeSignals(text);
  const complexTotal = complex.total + size.bonus;
  const reasons = [...complex.hits.map((h) => `complex: ${h}`), ...size.reasons.map((r) => `complex: ${r}`)];
  if (complexTotal >= 2) return { model: "opus", reasons };
  // "do not edit anything" is a promise to change nothing, not a change.
  const standard = score(text.replace(/\b(do not|don't|never|without|no)\s+(\w+)/gi, " "), STANDARD);
  reasons.push(...standard.hits.map((h) => `standard: ${h}`));
  if (complexTotal === 1 || standard.total >= 1) return { model: "sonnet", reasons };
  const search = score(text, SEARCH);
  reasons.push(...search.hits.map((h) => `search: ${h}`));
  if (search.total >= 1) return { model: "haiku", reasons };
  return { model: "sonnet", reasons: ["no clear signal: standard default"] };
}

/** 'haiku' | 'sonnet' | 'opus' for a helper's task text. */
export function classifyTask(taskText) {
  return explainTaskRoute(taskText).model;
}

// Which agent a new terminal starts in (Noam 2026-10-25: "אתה בעצם דואג של טרמינל חדש ישתנה
// לקודקס?"): Codex by default. Claude only when the task asks for it by name, or is about
// handling a conversation or open-ended reasoning rather than building something.
const NEEDS_CLAUDE = [
  [/\b(use|in|with|needs?|via|on)\s+claude\b|\bclaude[ -]code\b|--provider claude|קלוד/i, "asks for Claude"],
  [/\b(conversation|chat with|talk(ing)? (to|with)|reply to (him|her|noam|the user)|answer noam|persona|role-?play|tone of voice|coach(ing)?)\b/i, "conversation handling"],
  [/\b(think (it )?through|reason about|weigh (the )?(options|trade-?offs)|strategy|judg(e)?ment call|decide (whether|between)|second opinion)\b/i, "complex reasoning"],
];

/** { provider: 'codex' | 'claude', reasons } for a new terminal with no --provider. */
export function explainProviderRoute(taskText) {
  const text = String(taskText ?? "").trim();
  const reasons = NEEDS_CLAUDE.filter(([re]) => re.test(text)).map(([, why]) => why);
  return reasons.length ? { provider: "claude", reasons } : { provider: "codex", reasons: ["default: new terminals start in Codex"] };
}
