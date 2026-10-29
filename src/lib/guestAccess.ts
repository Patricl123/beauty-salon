// Only capabilities and request fingerprints are kept in sessionStorage. No business records / PII.
const TOKEN_KEY = "aura-booking-access-v1";
const COMMAND_KEY = "aura-pending-commands-v1";
interface Command {
  requestId: string;
  token: string;
  fingerprint: string;
  version?: number;
}
const memory = new Map<string, string>();
function read<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(memory.get(key) || sessionStorage.getItem(key) || "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  const json = JSON.stringify(value);
  memory.set(key, json);
  try {
    sessionStorage.setItem(key, json);
  } catch {
    /* capability remains in memory for this page */
  }
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function guestTokens(): Record<string, string> {
  return read(TOKEN_KEY, {});
}
export function rememberAccess(id: string, token: string) {
  write(TOKEN_KEY, { ...guestTokens(), [id]: token });
}
export function managementCode(id: string) {
  const token = guestTokens()[id];
  return token ? `${id}.${token}` : "";
}
export function parseManagementCode(code: string) {
  const match = code
    .trim()
    .match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-f0-9]{64})$/i,
    );
  return match
    ? { id: match[1].toLowerCase(), token: match[2].toLowerCase() }
    : null;
}
export async function getCommand(
  operation: string,
  payload: unknown,
  token?: string,
  version?: number,
): Promise<Command> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const commands = read<Record<string, Command>>(COMMAND_KEY, {});
  const current = commands[operation];
  if (
    current?.fingerprint === fingerprint &&
    (!token || current.token === token)
  )
    return current;
  const command = {
    requestId: crypto.randomUUID(),
    token: token || randomToken(),
    fingerprint,
    version,
  };
  commands[operation] = command;
  write(COMMAND_KEY, commands);
  return command;
}
export function finishCommand(operation: string, requestId: string) {
  const commands = read<Record<string, Command>>(COMMAND_KEY, {});
  if (commands[operation]?.requestId === requestId) {
    delete commands[operation];
    write(COMMAND_KEY, commands);
  }
}
// Pending commands survive reload. Clear only after acknowledgement or a definite database rejection.
