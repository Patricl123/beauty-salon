import { describe, expect, it } from "vitest";
import { readBackendConfig } from "./backendConfig";
import { adminDiff } from "./cloudRepository";
import { createSeed } from "../data/seed";
describe("Backend configuration and request boundaries", () => {
  it("keeps demo isolated and never silently falls back on partial cloud configuration", () => {
    expect(readBackendConfig({}).mode).toBe("demo");
    expect(() => readBackendConfig({ VITE_DATA_SOURCE: "supabase" })).toThrow();
    expect(() =>
      readBackendConfig({ VITE_SUPABASE_URL: "https://example.supabase.co" }),
    ).toThrow();
  });
  it("rejects secret keys before a production bundle is created without printing their values", () => {
    const secret = "sb_secret_TEST_ONLY_NEVER_A_REAL_KEY";
    try {
      readBackendConfig({
        VITE_DATA_SOURCE: "demo",
        VITE_SUPABASE_PUBLISHABLE_KEY: secret,
      });
      throw new Error("not rejected");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("скрыто");
    }
    expect(() =>
      readBackendConfig({ VITE_SERVICE_ROLE_KEY: "test-only" }),
    ).toThrow();
  });
  it("accepts only a public browser key and HTTPS (or local development URL)", () => {
    expect(
      readBackendConfig({
        VITE_DATA_SOURCE: "supabase",
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST_ONLY",
      }).mode,
    ).toBe("supabase");
    expect(() =>
      readBackendConfig({
        VITE_DATA_SOURCE: "supabase",
        VITE_SUPABASE_URL: "http://example.com",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST_ONLY",
      }),
    ).toThrow();
  });
  it("does not persist appointment prices, tokens or locally generated notifications through an admin snapshot patch", () => {
    const before = createSeed(),
      after = structuredClone(before);
    after.appointments[0].price = 1;
    after.appointments[0].status = "completed";
    after.notifications.push({
      id: "fake",
      appointmentId: "fake",
      event: "created",
      recipient: "fake",
      channel: "email",
      text: "fake",
      at: new Date().toISOString(),
      planned: false,
    });
    expect(adminDiff(before, after)).toEqual({});
    after.services[0].price = 2500;
    expect(adminDiff(before, after)).toHaveProperty("services");
  });
});
