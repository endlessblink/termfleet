const CONTENT_FIELDS = new Set([
  "data",
  "datapreview",
  "text",
  "output",
  "command",
  "paste",
  "payload",
  "key",
]);

/** Keep useful trace measurements while dropping terminal contents and literal keys. */
export function sanitizeTerminalLatencyTraceDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(details)) {
    const field = name.toLowerCase();
    if (CONTENT_FIELDS.has(field)) {
      if (field === "data" && typeof value === "string") {
        safe.dataLength = new TextEncoder().encode(value).length;
      }
      if (field === "key" && typeof value === "string") {
        safe.keyCategory = [...value].length === 1 ? "printable" : "named";
      }
      continue;
    }
    if (field.endsWith("preview") || field.endsWith("payload")) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      safe[name] = value;
    }
  }
  return safe;
}
