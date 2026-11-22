const SENSITIVE_KEY_PATTERN = /(key|token|secret|auth|signature|sig|pass|credential|cookie)/i;

export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "";
    }
    if (parsed.search) {
      parsed.search = "";
      return `${parsed.toString()}?[REDACTED_QUERY]`;
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/\?[^\s"']+/g, "?[REDACTED_QUERY]");
  }
}

export function redactRecord<T>(value: T): T {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      return redactUrl(value) as T;
    }
    return value.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']+/gi, "$1?[REDACTED_QUERY]") as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRecord(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactRecord(entry);
      }
    }
    return output as T;
  }

  return value;
}
