import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/state", async () => {
  const actual = await vi.importActual("../../src/utils/state");
  const settings = {
    apiKey: "test-api-key",
    batchSize: 5,
    flushIntervalMs: 100,
    piiRedact: "regex",
    hashAlgo: "blake3",
    walPath: false,
    anchorInterval: "1h",
    tls: { mtls: false },
  };

  return {
    ...actual,
    settings,
    initSettings: (opts: any) => {
      Object.assign(settings, opts);
    },
  };
});

import { canonicalJSON, digest, link } from "../../src/utils/hash";

describe("hash.ts", () => {
  describe("canonicalJSON", () => {
    it("should handle primitive values", () => {
      expect(canonicalJSON(null)).toBe("null");
      expect(canonicalJSON(123)).toBe("123");
      expect(canonicalJSON("test")).toBe('"test"');
      expect(canonicalJSON(true)).toBe("true");
    });

    it("should serialize arrays correctly", () => {
      expect(canonicalJSON([1, 2, 3])).toBe("[1,2,3]");
      expect(canonicalJSON(["a", "b", "c"])).toBe('["a","b","c"]');
      expect(canonicalJSON([{ a: 1 }, { b: 2 }])).toBe('[{"a":1},{"b":2}]');
    });

    it("should sort object keys alphabetically", () => {
      const unordered = { c: 3, a: 1, b: 2 };
      expect(canonicalJSON(unordered)).toBe('{"a":1,"b":2,"c":3}');
    });

    it("should handle nested objects and arrays", () => {
      const complex = {
        z: [3, 2, 1],
        a: { c: 3, b: 2, a: 1 },
        m: null,
      };
      expect(canonicalJSON(complex)).toBe(
        '{"a":{"a":1,"b":2,"c":3},"m":null,"z":[3,2,1]}'
      );
    });
  });

  describe("digest", () => {
    it("should generate consistent hashes for the same input", () => {
      const payload = "test string";
      const hash1 = digest(payload);
      const hash2 = digest(payload);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it("should generate different hashes for different inputs", () => {
      const hash1 = digest("input1");
      const hash2 = digest("input2");

      expect(hash1).not.toBe(hash2);
    });

    it("should use the configured hash algorithm", async () => {
      const { initSettings } = await import("../../src/utils/state");

      // Get BLAKE3 hash
      initSettings({ apiKey: "test-api-key", hashAlgo: "blake3" });
      const blake3Hash = digest("same input");

      // Get SHA-256 hash
      initSettings({ apiKey: "test-api-key", hashAlgo: "sha256" });
      const sha256Hash = digest("same input");

      // Reset to BLAKE3
      initSettings({ apiKey: "test-api-key", hashAlgo: "blake3" });

      expect(blake3Hash).not.toBe(sha256Hash);
    });
  });

  describe("link", () => {
    it("should create a LogEntry with hash and prevHash", () => {
      const core = {
        ts: 1625097600000,
        prompt: "Hello",
        response: "Response",
        meta: {
          latency_ms: 123,
          model: "gpt-4",
        },
      };

      const entry = link(null, core);

      expect(entry).toHaveProperty("hash");
      expect(entry).toHaveProperty("prevHash", null);
      expect(entry.ts).toBe(1625097600000);
      expect(entry.prompt).toBe("Hello");
      expect(entry.response).toBe("Response");
      expect(entry.meta.model).toBe("gpt-4");
    });

    it("should create a chain of linked entries", () => {
      const entry1 = link(null, {
        ts: 1625097600000,
        prompt: "First",
        response: "First Response",
        meta: {
          latency_ms: 100,
          model: "gpt-4",
        },
      });

      const entry2 = link(entry1.hash, {
        ts: 1625097700000,
        prompt: "Second",
        response: "Second Response",
        meta: {
          latency_ms: 200,
          model: "gpt-4",
        },
      });

      expect(entry2.prevHash).toBe(entry1.hash);
      expect(entry2.hash).not.toBe(entry1.hash);
    });
  });
});
