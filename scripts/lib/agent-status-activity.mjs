// Plain-language "what's happening now" for a shell command an agent runs.
//
// The cockpit is read by people who do not read shell. A raw head like
// "Running: sed -n" or "Running: mv /media/…/ai-develop" was either rejected by the
// header gate (leaving "Now not captured" on a busy pane) or leaked paths. Name the
// kind of work instead; unknown programs fall back to "Running <program>".

const FAMILIES = [
  [/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t)\b|^(?:npx\s+)?(?:playwright|vitest|jest|mocha)\b|^pytest\b|^cargo\s+test\b|^go\s+test\b|^node\s+--test\b/, "Running tests"],
  [/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|lint)\b|^(?:npx\s+)?(?:tsc|vite\s+build|eslint)\b|^cargo\s+(?:build|check|clippy)\b|^make\b/, "Building and checking the code"],
  [/^(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b|^pip3?\s+install\b|^cargo\s+add\b|^apt(?:-get)?\s+install\b/, "Installing packages"],
  [/^git\s+(?:commit|push|pull|merge|rebase|tag|cherry-pick|stash)\b/, "Saving work with git"],
  [/^git\b/, "Looking at the git history"],
  [/^gh\b/, "Checking GitHub"],
  [/^(?:sed|grep|rg|cat|head|tail|less|awk|wc|find|fd|tree|file|stat|du|df|jq|diff|sort|uniq|cut|nl)\b/, "Reading files"],
  [/^(?:mv|cp|rsync|ln|mkdir|touch|chmod|chown|tar|unzip|zip)\b/, "Moving and organizing files"],
  [/^(?:rm|rmdir|trash)\b/, "Removing files"],
  [/^(?:curl|wget|http)\b/, "Fetching from the web"],
  [/^(?:ssh|scp)\b/, "Working on a remote server"],
  [/^(?:docker|podman|kubectl)\b/, "Managing containers"],
  [/^(?:systemctl|journalctl|ps|pgrep|pkill|kill|top|htop|free|uptime)\b/, "Checking running services"],
  [/^(?:node|python3?|deno|bun|ruby|bash|sh)\b/, "Running a script"],
  [/^(?:ffmpeg|magick|convert|identify)\b/, "Processing media"],
  [/^(?:sleep|wait|timeout)\b/, "Waiting for something to finish"],
];

export function plainCommandActivity(command) {
  let text = String(command ?? "").replace(/\s+/g, " ").trim();
  // Drop navigation prefixes, env assignments, and privilege/timing wrappers.
  text = text.replace(/^(?:cd|z|pushd)\s+[^&;|]+(?:&&|;|\|\|)\s*/i, "");
  text = text.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "");
  text = text.replace(/^(?:sudo|env|nice|ionice(?:\s+-c\s*\d)?|time|rtk(?:\s+proxy)?|timeout\s+\d+[smh]?)\s+/, "");
  if (!text) return "";
  for (const [pattern, label] of FAMILIES) {
    if (pattern.test(text)) return label;
  }
  const program = text.split(/\s/)[0].split("/").pop() ?? "";
  return /^[\w.-]{2,30}$/.test(program) ? `Running ${program}` : "Running a command";
}
