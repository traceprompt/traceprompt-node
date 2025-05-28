### `README.md`

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

```ts
import { initTracePrompt, wrapLLM } from "@traceprompt/node";
import OpenAI from "openai";

initTracePrompt({
  tenantId: "tnt_abc123",
  cmkArn: process.env.TP_CMK_ARN!, // AWS KMS CMK ARN
  ingestUrl: "https://api.traceprompt.dev/v1/ingest",
});

const openai = new OpenAI();
const trackedChat = wrapLLM(openai.chat.completions.create, {
  modelVendor: "openai",
  modelName: "gpt-4o",
  userId: "alice",
});

const reply = await trackedChat("Hello, world!");
console.log(reply.choices[0].message.content);
```

---

## Configuration

| Key               | Description                           | Source (priority)                                         |
| ----------------- | ------------------------------------- | --------------------------------------------------------- |
| `tenantId`        | Unique tenant identifier              | code → env `TRACEPROMPT_TENANT_ID` → `.tracepromptrc.yml` |
| `cmkArn`          | AWS KMS CMK ARN (or `"local-dev"`)    | code → env `TP_CMK_ARN` → rc file                         |
| `ingestUrl`       | HTTPS endpoint for batch ingest       | code → env `TRACEPROMPT_INGEST_URL` → rc                  |
| `batchSize`       | Flush queue at N records (default 25) | same hierarchy                                            |
| `flushIntervalMs` | Flush every N ms (default 2000)       | same hierarchy                                            |

Local development mode:

```bash
export TP_CMK_ARN=local-dev
export LOCAL_DEV_KEK=$(openssl rand -hex 32)   # 32-byte hex key
```

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

### Can I self-host?

Yes. The design supports local PostgreSQL with the same Prisma schema. Contact us for enterprise deployment guidance.

---
