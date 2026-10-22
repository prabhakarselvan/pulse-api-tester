// Dynamic (generated-at-send-time) variables, e.g. {{$randomUUID}}, {{$timestamp}}.
// Resolved on the frontend and merged into the variable map sent to the backend,
// so a fresh value is produced each time the request is sent.

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

const FIRST_NAMES = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Kai", "Ivy", "Leo", "Nina", "Max"];

/** Catalogue of supported dynamic variables (for docs / autocomplete). */
export const DYNAMIC_VARS: { name: string; description: string }[] = [
  { name: "$randomUUID", description: "A random v4 UUID" },
  { name: "$guid", description: "Alias of $randomUUID" },
  { name: "$timestamp", description: "Current Unix time (seconds)" },
  { name: "$isoTimestamp", description: "Current time, ISO-8601" },
  { name: "$randomInt", description: "Integer 0–1000" },
  { name: "$randomBoolean", description: '"true" or "false"' },
  { name: "$randomEmail", description: "A random example.com email" },
  { name: "$randomFirstName", description: "A random first name" },
  { name: "$randomHex", description: "8 random hex characters" },
  { name: "$randomPassword", description: "A 12-char random string" },
];

export function generateDynamicValue(name: string): string | null {
  switch (name) {
    case "$randomUUID":
    case "$guid":
      return uuid();
    case "$timestamp":
      return Math.floor(Date.now() / 1000).toString();
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomInt":
      return Math.floor(Math.random() * 1001).toString();
    case "$randomBoolean":
      return Math.random() < 0.5 ? "true" : "false";
    case "$randomEmail":
      return `user${Math.floor(Math.random() * 100000)}@example.com`;
    case "$randomFirstName":
      return FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    case "$randomHex":
      return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    case "$randomPassword":
      return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    default:
      return null;
  }
}

const DYNAMIC_RE = /\{\{(\$[a-zA-Z0-9_]+)\}\}/g;

/**
 * Scan a request for `{{$dynamic}}` tokens and return a copy of `variables`
 * augmented with a freshly-generated value per distinct token. Existing (user)
 * variables of the same name are never overwritten.
 */
export function injectDynamicVars(
  request: unknown,
  variables?: Record<string, string>,
): Record<string, string> {
  const out = { ...(variables ?? {}) };
  let json: string;
  try {
    json = JSON.stringify(request);
  } catch {
    return out;
  }
  DYNAMIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DYNAMIC_RE.exec(json)) !== null) {
    const name = m[1];
    if (name in out) continue;
    const value = generateDynamicValue(name);
    if (value != null) out[name] = value;
  }
  return out;
}
