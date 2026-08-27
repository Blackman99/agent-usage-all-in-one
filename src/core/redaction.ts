export function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(
      /((?:api[-_ ]?key|token|secret|key)\s*(?::|=|is|was)?\s*)[A-Za-z0-9._-]{8,}/gi,
      '$1[REDACTED]'
    );
}

export function publicErrorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : 'Unexpected error');
}
