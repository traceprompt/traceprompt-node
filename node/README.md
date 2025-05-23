# Traceprompt SDK · Tamper-Proof AI Logging for audit & compliance.

![npm](https://img.shields.io/npm/v/@traceprompt/sdk?color=blue)
![license](https://img.shields.io/npm/l/mit)
![build](https://github.com/traceprompt/sdk/actions/workflows/ci.yml/badge.svg)

Hash, mask and anchor every AI prompt & response in **\< 1 ms**. Pass banking, healthcare & global AI audits with zero extra infra.

---

## Features

| Feature                        | Description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| **Cryptographic immutability** | BLAKE3/SHA-256 hash-chain + hourly Merkle checkpoints         |
| **In-process PII redaction**   | Ultra-fast regex (default) or opt-in smart NER                |
| **< 0.3 ms overhead**          | Streaming hashing + lock-free buffer, network I/O off-thread  |
| **Batch flush & WAL**          | No drops on crash; replay on start                            |
| **OpenTelemetry attrs**        | `traceprompt.hash`, `traceprompt.latency_ms`                  |
| **Compatible ingest**          | POSTs to `/logs` endpoint (Fastify sample) or immudb side-car |

---

## Quick start

```bash
npm i @traceprompt/sdk openai   # or any LLM client
```

```ts
import { init, wrap } from "@traceprompt/sdk";
import OpenAI from "openai";

init({
  // one-time bootstrap
  apiKey: process.env.TRACEPROMPT_API_KEY!,
  /* optional */
  piiRedact: "regex", // 'regex' | 'smart' | 'off'
  batchSize: 100,
  flushIntervalMs: 50,
});

const openai = wrap(OpenAI); // drop-in replacement

/* normal usage */
const res = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Email john.doe@example.com results." }],
});
console.log(res.choices[0].message.content);
```

_Every prompt & response is now redacted, hashed, linked, queued, and flushed to your ingest API — caller overhead ≈ 0.25 ms._

---

## ⚙️ Configuration

| Key               | Default                | Notes                                         |
| ----------------- | ---------------------- | --------------------------------------------- |
| `apiKey`          | **required**           | SaaS / ingest authentication                  |
| `piiRedact`       | `'regex'`              | `'smart'` uses spaCy-wasm (≈3 ms)             |
| `batchSize`       | `100`                  | Ring-buffer length & POST batch size          |
| `flushIntervalMs` | `50`                   | Worker wakes every N ms                       |
| `hashAlgo`        | `'blake3'`             | Or `'sha256'` (FIPS)                          |
| `walPath`         | `/tmp/traceprompt.wal` | Disable with `false`                          |
| `tls.mtls`        | `false`                | Enable + provide `cert`/`key` for client-auth |

---

## Advanced

### Attach custom metadata

```ts
import { enrich } from '@traceprompt/sdk';

enrich({ userId:'u_123', session:'s_789' });
await openai.chat.completions.create({...});
```

### OpenTelemetry linkage

If your app is instrumented, the SDK adds span attributes automatically:

```shell
traceprompt.hash      = 5f2e70...b8c9
traceprompt.latency_ms= 703
```

### Smart NER redaction

Install extras only if you need name/org masking:

```bash
npm i @spacy/wasm-node @spacy/ner-utils
Traceprompt.init({ piiRedact:'smart' });
```

---

## Ingest & storage reference (AWS)

```
Client pod
 └─> /logs  (Fastify gRPC/HTTP, mTLS) ──► immudb STS  ──► S3 Object Lock
                          │
                          └─ anchor-service (CronJob) → Bitcoin / Git tag
```

Sample Helm charts & Terraform modules live in `/infra`.

---

## Development

```bash
pnpm i
pnpm run test           # Jest + ts-jest
pnpm run bench          # k6 perf harness (<0.3 ms p95)
pnpm run dev            # ts-node watch
```

---

## FAQ

- **Does this slow down my LLM calls?**
  Regex path adds < 0.3 ms p95; smart NER adds \~3 ms.

- **Can I run everything on-prem?**
  Yes — deploy the Fastify ingest & immudb side-car inside your cluster; nothing leaves.

- **What happens if the process crashes?**
  Entries spill to a write-ahead log; on boot `replayWal()` re-queues them before new traffic flows.

---

## License

MIT © Traceprompt
