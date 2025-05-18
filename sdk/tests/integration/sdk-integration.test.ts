import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redact } from "../../src/redactor";

class MockOpenAI {
  chat = {
    completions: {
      create: async (params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
      }) => {
        // Just pass through the request and return a consistent response
        return {
          choices: [
            {
              message: {
                content: `Response to: ${params.messages[0].content}`,
                role: "assistant",
              },
              index: 0,
              finish_reason: "stop",
            },
          ],
          model: params.model,
          id: "mock-completion-id",
          created: Date.now(),
        };
      },
    },
  };
}

vi.mock("@/state", async () => {
  const actual = await vi.importActual("@/state");
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

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker {
    constructor() {}
    on() {}
  },
  parentPort: {
    postMessage: vi.fn(),
  },
}));

describe("TracePrompt SDK Integration", () => {
  let init: any;
  let wrap: any;
  let enrich: any;

  beforeEach(async () => {
    vi.resetModules();
    const sdk = await import("../../src/index");
    init = sdk.init;
    wrap = sdk.wrap;
    enrich = sdk.enrich;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should log AI interactions", async () => {
    init({
      apiKey: "test-api-key",
      batchSize: 5,
      flushIntervalMs: 100,
      piiRedact: "regex",
      walPath: false,
    });

    const WrappedOpenAI = wrap(MockOpenAI);
    const openai = new WrappedOpenAI();

    enrich({
      userId: "test-user-123",
      sessionId: "test-session-456",
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: "Test message with email test@example.com",
        },
      ],
    });
    
    expect(response).toBeDefined();
    expect(response.choices[0].message.content).toContain("Response to:");
  });

  it("should redact PII from prompts using regex", async () => {
    init({
      apiKey: "test-api-key",
      piiRedact: "regex",
      walPath: false,
    });

    const message = {
      role: "user",
      content:
        "My email is john.doe@example.com and my credit card is 4111-1111-1111-1111 and my phone is 555-123-4567",
    };

    const redacted = redact(message, "regex");

    const redactedStr = JSON.stringify(redacted);

    expect(redactedStr).not.toContain("john.doe@example.com");
    expect(redactedStr).not.toContain("4111-1111-1111-1111");
    expect(redactedStr).not.toContain("555-123-4567");

    expect(redactedStr).toMatch(/\[\s*EMAIL\s*\]|\[\s*REDACTED\s*\]|\*\*\*/i);
    expect(redactedStr).toMatch(
      /\[\s*CREDIT_CARD\s*\]|\[\s*REDACTED\s*\]|\*\*\*/i
    );
    expect(redactedStr).toMatch(/\[\s*PHONE\s*\]|\[\s*REDACTED\s*\]|\*\*\*/i);
  });
});
