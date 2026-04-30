const ENV_VAR_RE = /^\$([A-Z][A-Z0-9_]*)$/;

export function resolveEnvIndirection(
  value: string,
  env: Record<string, string | undefined>,
): string {
  const match = value.match(ENV_VAR_RE);
  if (!match) return value;
  const name = match[1]!;
  const resolved = env[name];
  if (resolved === undefined) {
    throw new Error(`Environment variable not set: ${name}`);
  }
  return resolved;
}
