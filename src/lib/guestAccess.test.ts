import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishCommand,
  getCommand,
  managementCode,
  parseManagementCode,
  randomToken,
  rememberAccess,
} from "./guestAccess";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
describe("Private capability and pending request lifecycle", () => {
  it("creates 256-bit random tokens and validates the management code format", () => {
    const a = randomToken(),
      b = randomToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(parseManagementCode("phone:+996000000001")).toBeNull();
    const id = crypto.randomUUID();
    rememberAccess(id, a);
    expect(parseManagementCode(managementCode(id))).toEqual({ id, token: a });
  });
  it("reuses a pending request and original version after an ambiguous response", async () => {
    const operation = "retry:" + crypto.randomUUID();
    const first = await getCommand(operation, { time: "10:00" }, undefined, 1);
    const retry = await getCommand(
      operation,
      { time: "10:00" },
      first.token,
      2,
    );
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.version).toBe(1);
  });
  it("uses a fresh request for a changed payload or acknowledged operation", async () => {
    const operation = "different:" + crypto.randomUUID();
    const first = await getCommand(operation, { time: "10:00" });
    const changed = await getCommand(operation, { time: "11:00" });
    expect(changed.requestId).not.toBe(first.requestId);
    finishCommand(operation, changed.requestId);
    const next = await getCommand(operation, { time: "11:00" });
    expect(next.requestId).not.toBe(changed.requestId);
  });
  it("stores only a hash of request payload, never client fields", async () => {
    const operation = "privacy:" + crypto.randomUUID();
    await getCommand(operation, {
      clientName: "Sensitive test name",
      phone: "+996000000099",
      comment: "Sensitive test comment",
    });
    const raw = sessionStorage.getItem("aura-pending-commands-v1")!;
    expect(raw).not.toContain("Sensitive test");
    expect(raw).not.toContain("+996000000099");
  });
});
