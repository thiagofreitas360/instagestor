const secretKey = /token|password|secret|authorization|cookie|oauth.*code|encryption.*key/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(item)]),
  );
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  component: string,
  event: string,
  fields: Record<string, unknown> = {},
) {
  const entry = redact({ timestamp: new Date().toISOString(), level, component, event, ...fields });
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
