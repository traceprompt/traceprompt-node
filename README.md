![Traceprompt Banner](https://www.traceprompt.com/Banner.png)

# Traceprompt SDK for Node.js

**Audit-ready, tamper-evident logging for every LLM prompt and response.**  
Simple drop-in wrapper for your `openai`, `anthropic` or any LLM client to stream encrypted, hash-chained events to an immutable ledger. Ready for FINRA, HIPAA, and EU AI Act compliance audits.

---

## Features

- **Client-side AES-256-GCM encryption** with **customer-managed KMS keys** - Traceprompt never sees cleartext
- **BLAKE3 hash chain with Merkle root anchoring** to GitHub every 60 seconds
- **Automatic token counting** and latency tracking
- **Batched transport** with exponential backoff retry - under 2ms P95 overhead
- Works on Node 18+ - Fargate, Vercel, Lambda, Kubernetes

---

## Quick start

```bash
# NPM
npm install @traceprompt-node dotenv

# Yarn
yarn add @traceprompt-node dotenv
```

**1. Configure your API key**

**Option A: Using a config file (recommended)**

Create a `.tracepromptrc.yml` file:

```yaml
apiKey: tp_live_xxxxx

# Optional: add static metadata to all logs
staticMeta:
  app: "my-llm-service"
  env: "prod"
```

Create a `.env` file to point to your config:

```bash
TRACEPROMPT_RC=".tracepromptrc.yml"
```

**Option B: Using environment variables only**

```bash
export TRACEPROMPT_API_KEY=tp_live_xxxxx
export TRACEPROMPT_LOG_LEVEL=info
```

**2. Wrap your LLM calls**

```typescript
import { config } from "dotenv";
import { init, wrap } from "@traceprompt/node";
import OpenAI from "openai";

// Load environment variables (if using .env file)
config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

await init(); // Auto-resolves orgId and cmkArn from API key

const trackedChat = wrap(
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

### Configuration Loading Order (highest to lowest priority):

1. **Code parameters** passed to `init({})`
2. **Environment variables** (`TRACEPROMPT_API_KEY`, etc.)
3. **Config file** specified by `TRACEPROMPT_RC` environment variable
4. **Default config files** (`.tracepromptrc.yml`, `.tracepromptrc.yaml`, `traceprompt.yml`, `traceprompt.yaml`)

### Configuration Options

| Key          | Description                | Environment Variable     | Config File |
| ------------ | -------------------------- | ------------------------ | ----------- |
| `apiKey`     | Your TracePrompt API key   | `TRACEPROMPT_API_KEY`    | ✅          |
| `staticMeta` | Metadata added to all logs | ❌                       | ✅          |
| `logLevel`   | SDK logging verbosity      | `TRACEPROMPT_LOG_LEVEL`  | ✅          |
| `ingestUrl`  | API endpoint (optional)    | `TRACEPROMPT_INGEST_URL` | ✅          |

### Config File Location

Set the config file path using the `TRACEPROMPT_RC` environment variable:

```bash
# In .env file
TRACEPROMPT_RC=".tracepromptrc.yml"

# Or as environment variable
export TRACEPROMPT_RC="/path/to/your/config.yml"
```

**Note:** `orgId`, `cmkArn`, and `ingestUrl` are automatically resolved from your API key - no manual configuration needed.

---

## FAQ

### Does Traceprompt store my data in cleartext?

No. The SDK encrypts prompts and responses using AES-256-GCM with your KMS key before they leave your process. Traceprompt's servers only receive and store encrypted ciphertext.

### How much latency does it add?

Approximately 0.19ms for encryption plus 0.01ms for hashing on modern hardware. Network uploads are asynchronous and batched.

### What about data privacy?

All data is encrypted client-side using your customer-managed encryption key (CMK). Zero cleartext ever reaches Traceprompt servers. The hash chain provides tamper evidence without exposing content.

---
