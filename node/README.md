### `README.md`

# traceprompt SDK for Node.js

**Audit-ready, tamper-evident logging for every LLM prompt/response.**  
Two lines of code wrap your `openai`, `anthropic`, `groq` (or any HTTP-based) client and stream encrypted, hash-chained events to an immutable ledger—ready for FINRA, HIPAA §164.312(b), and EU AI Act audits.

---

## ✨ Features
* **Client-side AES-256-GCM** encryption with **customer-managed KMS keys** – traceprompt never sees clear-text.
* **BLAKE3 hash-chain + hourly Merkle root anchoring** (OpenTimestamps by default).
* **Automatic token counting** and latency metrics.
* **Batcher** with back-off retries; < 2 ms median overhead.
* **Prometheus hooks** out-of-the-box.
* Works anywhere Node 18 + runs—Fargate, Vercel, Lambdas, k8s.

---

## Quick start

```bash
npm i @traceprompt/node
# or yarn add @traceprompt/node
````

```ts
import { initTracePrompt, wrapLLM } from '@traceprompt/node'
import OpenAI from 'openai'

initTracePrompt({
  tenantId:  'tnt_abc123',
  cmkArn:    process.env.TP_CMK_ARN!,           // AWS KMS CMK ARN
  ingestUrl: 'https://api.traceprompt.dev/v1/ingest'
})

const openai = new OpenAI()
const safeChat = wrapLLM(openai.chat.completions.create, {
  modelVendor: 'openai',
  modelName:   'gpt-4o',
  userId:      'alice'
})

const reply = await safeChat('Hello, world!')
console.log(reply.choices[0].message.content)
```

---

## Configuration

| Key               | Description                            | Source (priority)                                         |
| ----------------- | -------------------------------------- | --------------------------------------------------------- |
| `tenantId`        | Unique tenant / customer ID.           | code ➔ env `TRACEPROMPT_TENANT_ID` ➔ `.tracepromptrc.yml` |
| `cmkArn`          | AWS KMS CMK ARN (or `"local-dev"`).    | code ➔ env `TP_CMK_ARN` ➔ rc file                         |
| `ingestUrl`       | HTTPS endpoint for batch ingest.       | code ➔ env `TRACEPROMPT_INGEST_URL` ➔ rc                  |
| `batchSize`       | Flush queue at N records (default 25). | same hierarchy                                            |
| `flushIntervalMs` | Flush every N ms (default 2000).       | same hierarchy                                            |

Local-dev mode

```bash
export TP_CMK_ARN=local-dev
export LOCAL_DEV_KEK=$(openssl rand -hex 32)   # 32-byte hex key
```

---

## Metrics

| Metric                             | Type      | What it tells you               |
| ---------------------------------- | --------- | ------------------------------- |
| `traceprompt_encrypt_ms`           | Histogram | Client-side encryption latency. |
| `traceprompt_flush_failures_total` | Counter   | Failed batch POSTs.             |
| `traceprompt_queue_depth`          | Gauge     | Current in-memory queue size.   |

Expose via:

```ts
import { registry } from '@traceprompt/node/dist/metrics'
app.get('/metrics', (_, res) => res.end(registry.metrics()))
```

---

## FAQ

### Does traceprompt store my data?

No. The SDK encrypts prompt + response **before** they leave your process, using **your** KMS key. TracePrompt’s ingest service sees only ciphertext.

### How much latency does it add?

\~0.8 ms encryption + 0.05 ms hashing on a modern CPU; network flush is asynchronous.

### Can I self-host?

Yes—point `ingestUrl` at your own deployment. The ingest service (Go binary + Prisma schema) is OSS under `server/`.

### What about PII masking?

Client-side masking pipeline (regex/FPE sync + optional async NER) ships in `@traceprompt/mask` add-on.

---

## Contributing

```bash
git clone https://github.com/traceprompt/sdk-node.git
pnpm install
pnpm test        # runs uvu tests
pnpm build
```

PRs & issues welcome!
