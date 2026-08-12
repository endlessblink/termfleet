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
  "🪴",
  "🌱",
  "🌿",
  "🌻",
  "🌙",
  "☀️",
  "🌈",
  "🔥",
  "💡",
  "🔭",
  "🛰️",
  "🛸",
  "🗺️",
  "🪐",
  "🌍",
  "🌊",
  "🏔️",
  "🏗️",
  "🏠",
  "🏛️",
  "🏭",
  "🚂",
  "🚲",
  "🛵",
  "🚦",
  "🛡️",
  "⚡",
  "🔧",
  "🔩",
  "🪛",
  "🧲",
  "⚖️",
  "🧯",
  "🧬",
  "🧫",
  "🧮",
  "🗃️",
  "🗄️",
  "📁",
  "📌",
  "📍",
  "🔗",
  "🔑",
  "🔎",
  "🧵",
  "🧶",
  "🖋️",
  "✏️",
  "📐",
  "📏",
  "🖼️",
  "🎼",
  "🎵",
  "🎙️",
  "🎮",
  "🕹️",
  "🏁",
  "🎲",
  "🃏",
  "🦊",
  "🐙",
  "🦉",
  "🐝",
  "🦋",
  "🐳",
  "🦄",
];

function normalizeProjectIdentity(value: string) {
  const leaf = value.split(/[\\/]/).filter(Boolean).pop() ?? value;
  return leaf
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

export function projectEmojiFor(pathOrName: string, avoid: Iterable<string> = []) {
  const identity = normalizeProjectIdentity(pathOrName);
  const used = new Set(avoid);
  const semantic = [
    [/\bdesigners?ai\b|designersai|design-ai|design/, "🎨"],
    [/rough-cut|video|film|editor/, "🎬"],
    [/bina-ve-ze|course|learning|academy|education/, "🎓"],
    [/bina-meatzevet|payment|billing|invoice|freelance/, "💼"],
    [/hermes|launcher|desktop/, "🪽"],
    [/termfleet|terminal|devops|ops|infrastructure/, "🧭"],
    [/flow-state|watchpost|monitor|watch|status|observability/, "📡"],
    [/bot|automation|agent/, "🤖"],
    [/arthouse|art|gallery|creative/, "🎭"],
    [/contract|client|proposal/, "📄"],
    [/linux|cc-linux|system|shell/, "🐧"],
    [/security|auth|secret|vault/, "🔐"],
    [/data|analytics|report|metrics/, "📊"],
    [/web|site|frontend|browser/, "🌐"],
  ] as const;
  const semanticEmoji = semantic.find(([pattern]) => pattern.test(identity))?.[1];
  if (semanticEmoji && !used.has(semanticEmoji)) return semanticEmoji;

  const start = hashProjectIdentity(identity) % FALLBACK_PROJECT_EMOJIS.length;
  for (let offset = 0; offset < FALLBACK_PROJECT_EMOJIS.length; offset += 1) {
    const candidate = FALLBACK_PROJECT_EMOJIS[(start + offset) % FALLBACK_PROJECT_EMOJIS.length];
    if (!used.has(candidate)) return candidate;
  }
  return semanticEmoji ?? FALLBACK_PROJECT_EMOJIS[start];
}
