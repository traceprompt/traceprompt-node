![Traceprompt Logo](branding/logo.png)

# Traceprompt SDK for Node.js

**Audit-ready, tamper-evident logging for every LLM prompt and response.**  
Two lines of code wrap your `openai`, `anthropic` or any LLM client to stream encrypted, hash-chained events to an immutable ledger. Ready for FINRA, HIPAA, and EU AI Act compliance audits.

---

## Features

- **Client-side AES-256-GCM encryption** with **customer-managed KMS keys** - Traceprompt never sees cleartext
- **BLAKE3 hash chain with hourly Merkle root anchoring** to Bitcoin via OpenTimestamps
- **Automatic token counting** and latency metrics
- **Batched transport** with exponential backoff retry - under 2ms P95 overhead
- **Prometheus metrics** included
- Works on Node 18+ - Fargate, Vercel, Lambda, Kubernetes

---

## Quick start

```bash
npm i @traceprompt/node
# or yarn add @traceprompt/node
```

**1. Configure your API key**

Create a `traceprompt.yml` file:

```yaml
apiKey: tp_live_xxxxx

# Optional: add static metadata to all logs
staticMeta:
  app: "my-llm-service"
  env: "prod"
```

Or use environment variables:

```bash
export TRACEPROMPT_API_KEY=tp_live_xxxxx
export TRACEPROMPT_LOG_LEVEL=verbose
```

**2. Wrap your LLM calls**

```typescript
import { initTracePrompt, wrapLLM } from "@traceprompt/node";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

await initTracePrompt(); // Auto-resolves orgId and cmkArn from API key

const trackedChat = wrapLLM(
  (prompt) =>
    openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o",
    }),
  {
    modelVendor: "openai",
    modelName: "gpt-4o",
    userId: "alice",
  }
);

const response = await trackedChat("Hello, world!");
console.log(response.choices[0].message.content);
```

---

## Configuration

| Key          | Description                | Source (priority)                                    |
| ------------ | -------------------------- | ---------------------------------------------------- |
| `apiKey`     | Your TracePrompt API key   | code → env `TRACEPROMPT_API_KEY` → `traceprompt.yml` |
| `staticMeta` | Metadata added to all logs | code → `traceprompt.yml` only                        |
| `logLevel`   | SDK logging verbosity      | env `TRACEPROMPT_LOG_LEVEL`                          |

**Note:** `orgId`, `cmkArn`, and `ingestUrl` are automatically resolved from your API key - no manual configuration needed.

---

## Metrics

| Metric                             | Type      | Description                    |
| ---------------------------------- | --------- | ------------------------------ |
| `traceprompt_prompts_total`        | Counter   | Total prompts processed        |
| `traceprompt_encrypt_ms_p95`       | Histogram | Client-side encryption latency |
| `traceprompt_flush_failures_total` | Counter   | Failed batch uploads           |

Expose via:

```ts
import { registry } from "@traceprompt/node";
app.get("/metrics", (_, res) => res.end(registry.metrics()));
```

---

## FAQ

### Does Traceprompt store my data in cleartext?

No. The SDK encrypts prompts and responses using AES-256-GCM with your KMS key before they leave your process. Traceprompt's servers only receive and store encrypted ciphertext.

### How much latency does it add?

Approximately 0.19ms for encryption plus 0.01ms for hashing on modern hardware. Network uploads are asynchronous and batched.

### What about data privacy?

All data is encrypted client-side using your customer-managed encryption key (CMK). Zero cleartext ever reaches Traceprompt servers. The hash chain provides tamper evidence without exposing content.

---
