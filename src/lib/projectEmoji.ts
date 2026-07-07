const FALLBACK_PROJECT_EMOJIS = [
  "💻",
  "🧭",
  "📦",
  "🧪",
  "🛠️",
  "🚀",
  "🗂️",
  "🔬",
  "🧩",
  "📡",
  "📝",
  "🎯",
  "🧠",
  "🎨",
  "🎬",
  "🤖",
  "📊",
  "🔐",
  "🌐",
  "⚙️",
  "🖥️",
  "📚",
  "🧰",
  "🪄",
  "✨",
];

function normalizeProjectIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[_\s]+/g, "-");
}

function hashProjectIdentity(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function projectEmojiFor(pathOrName: string) {
  const identity = normalizeProjectIdentity(pathOrName);
  if (/\bdesigners?ai\b|designersai|design-ai|design/.test(identity)) return "🎨";
  if (/rough-cut|video|film|editor|content-creation/.test(identity)) return "🎬";
  if (/bina-ve-ze|course|learning|academy|education/.test(identity)) return "🎓";
  if (/bina-meatzevet|payment|billing|invoice|freelance/.test(identity)) return "💼";
  if (/hermes|launcher|desktop/.test(identity)) return "🪽";
  if (/termfleet|terminal|devops|ops|infrastructure/.test(identity)) return "🧭";
  if (/flow-state|watchpost|monitor|watch|status|observability/.test(identity)) return "📡";
  if (/bot|automation|agent/.test(identity)) return "🤖";
  if (/arthouse|art|gallery|creative/.test(identity)) return "🎭";
  if (/contract|client|proposal/.test(identity)) return "📄";
  if (/linux|cc-linux|system|shell/.test(identity)) return "🐧";
  if (/security|auth|secret|vault/.test(identity)) return "🔐";
  if (/data|analytics|report|metrics/.test(identity)) return "📊";
  if (/web|site|frontend|browser/.test(identity)) return "🌐";
  return FALLBACK_PROJECT_EMOJIS[hashProjectIdentity(identity) % FALLBACK_PROJECT_EMOJIS.length];
}
