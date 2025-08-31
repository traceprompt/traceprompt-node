![Traceprompt Banner](https://www.traceprompt.com/Banner.png)

# Traceprompt SDK for Node.js

**Audit-ready, tamper-evident logging for LLM applications, agents, and tool calls.**  
Complete observability for AI workflows with client-side encryption, hash-chained integrity, and agent tracing. Ready for FINRA, HIPAA, and EU AI Act compliance audits.

[![GitHub](https://img.shields.io/badge/GitHub-traceprompt--node-blue?logo=github)](https://github.com/traceprompt/traceprompt-node)

---

## Features

### **Audit-Grade Security**

- **Client-side AES-256-GCM encryption** with **customer-managed KMS keys** - Traceprompt never sees cleartext
- **BLAKE3 hash chain** with tamper-evident integrity verification
- **Deterministic event ordering** with monotonic indexing per trace

### **Complete AI Workflow Tracing**

- **Agent workflow tracing** with `wrapAgent()` - captures full agent sessions as root spans
- **Tool call tracing** with `wrapTool()` - separate ToolCall and ToolResult spans
- **LLM call tracing** with `wrap()` - captures all model interactions
- **Trace correlation** with parent-child relationships and request IDs

### **Production Ready**

- **Automatic token counting** and latency tracking with provider alignment
- **Batched transport** with exponential backoff retry - under 2ms P95 overhead
- **Configuration-driven agent identity** via `.tracepromptrc.yml` or environment variables
- Works on Node 18+ - Fargate, Vercel, Lambda, Kubernetes

---

## Quick start

```bash
# NPM
npm install @traceprompt-node dotenv

# Yarn
yarn add @traceprompt-node dotenv
```

**1. Get your API key**

Sign up at [traceprompt.com](https://traceprompt.com) and create an API key from your dashboard.

**2. Configure your API key**

**Option A: Using a config file (recommended)**

Create a `.tracepromptrc.yml` file:

```yaml
apiKey: tp_live_xxxxx

# Optional: add static metadata to all logs
staticMeta:
  app: "my-llm-service"
  env: "prod"

# Optional: configure agent identity (for wrapAgent)
agent:
  name: customer_service_v1
  id: a7c9f7c4-3d8e-4b2f-9a1e-5c8d9f0b1e0c # Stable UUID across deployments
  version: 1.2.3
  kind: customer-service
  policy_profile: production/customer-facing
```

Create a `.env` file to point to your config:

```bash
TRACEPROMPT_RC=".tracepromptrc.yml"
```

**Option B: Using environment variables only**

```bash
export TRACEPROMPT_API_KEY=tp_live_xxxxx
export TRACEPROMPT_LOG_LEVEL=info

# Optional: Agent identity configuration
export TRACEPROMPT_AGENT_NAME=customer_service_v1
export TRACEPROMPT_AGENT_ID=a7c9f7c4-3d8e-4b2f-9a1e-5c8d9f0b1e0c
export TRACEPROMPT_AGENT_VERSION=1.2.3
export TRACEPROMPT_AGENT_KIND=customer-service
export TRACEPROMPT_POLICY_PROFILE=production/customer-facing
```

**3. Basic LLM call tracing**

```typescript
import { config } from "dotenv";
import { init, wrap } from "traceprompt-node";
import OpenAI from "openai";

config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
await init();

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

**4. Agent and tool workflow tracing**

```typescript
import { init, wrap, wrapTool, wrapAgent } from "traceprompt-node";

await init();

// Wrap your tools
const searchTool = wrapTool(
  async (query: string) => {
    // Your tool implementation
    return await searchDatabase(query);
  },
  "database_search", // Tool name
  "1.0" // Tool version
);

// Wrap your agent function
const customerAgent = wrapAgent(
  async (customerQuery: string) => {
    const searchResults = await searchTool(customerQuery);
    const response = await llmCall(
      `Based on: ${searchResults}, answer: ${customerQuery}`
    );
    return response;
  }
  // Agent metadata comes from .tracepromptrc.yml or environment variables
);

// Full trace: AgentRun → ToolCall → ToolResult → ModelCall
const result = await customerAgent("What are your business hours?");
```

---

## Configuration

### Configuration Loading Order (highest to lowest priority):

1. **Code parameters** passed to `init({})`
2. **Environment variables** (`TRACEPROMPT_API_KEY`, etc.)
3. **Config file** specified by `TRACEPROMPT_RC` environment variable
4. **Default config files** (`.tracepromptrc.yml`, `.tracepromptrc.yaml`, `traceprompt.yml`, `traceprompt.yaml`)

### Configuration Options

| Key                     | Description                | Environment Variable         | Config File |
| ----------------------- | -------------------------- | ---------------------------- | ----------- |
| `apiKey`                | Your TracePrompt API key   | `TRACEPROMPT_API_KEY`        | ✅          |
| `staticMeta`            | Metadata added to all logs | ❌                           | ✅          |
| `logLevel`              | SDK logging verbosity      | `TRACEPROMPT_LOG_LEVEL`      | ✅          |
| `ingestUrl`             | API endpoint (optional)    | `TRACEPROMPT_INGEST_URL`     | ✅          |
| **Agent Configuration** |                            |                              |             |
| `agent.name`            | Agent display name         | `TRACEPROMPT_AGENT_NAME`     | ✅          |
| `agent.id`              | Stable agent UUID          | `TRACEPROMPT_AGENT_ID`       | ✅          |
| `agent.version`         | Agent semantic version     | `TRACEPROMPT_AGENT_VERSION`  | ✅          |
| `agent.kind`            | Agent type/framework       | `TRACEPROMPT_AGENT_KIND`     | ✅          |
| `agent.policy_profile`  | Compliance policy profile  | `TRACEPROMPT_POLICY_PROFILE` | ✅          |

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

## Agent & Tool Tracing Patterns

### Trace Structure

Traceprompt creates audit-grade traces with deterministic ordering and hash-chain integrity:

```
AgentRun (event_index: 1, prev_event_hash: null)  # Root span
├─ ToolCall (event_index: 2)                      # Tool input
│  └─ ToolResult (event_index: 3)                 # Tool output
└─ ModelCall (event_index: 4)                     # LLM response
```

### Trace Correlation

- **`trace_id`**: Groups all events in a single agent workflow
- **`span_id`**: Unique identifier for each operation
- **`parent_span_id`**: Links child spans to their parent
- **`event_index`**: Monotonic ordering within each trace
- **`prev_event_hash`**: Tamper-evident hash chain

### Agent Identity & Compliance

Each `AgentRun` includes a complete identity block for audit compliance:

- **`agent_name`**: Human-readable identifier (e.g., "customer_service_v1")
- **`agent_id`**: Stable UUID that persists across deployments
- **`agent_version`**: Semantic version for change tracking
- **`agent_kind`**: Framework type (e.g., "langgraph", "crewai", "custom")
- **`agent_fingerprint`**: BLAKE3 hash of agent configuration
- **`policy_profile`**: Compliance policy (e.g., "production/customer-facing")

This enables auditors to verify "what agent version was used" and "did anything change between runs."

---

## FAQ

### Does Traceprompt store my data in cleartext?

No. The SDK encrypts prompts and responses using AES-256-GCM with your KMS key before they leave your process. Traceprompt's servers only receive and store encrypted ciphertext.

### How much latency does it add?

Approximately 0.19ms for encryption plus 0.01ms for hashing on modern hardware. Network uploads are asynchronous and batched.

### What about data privacy?

All data is encrypted client-side using your customer-managed encryption key (CMK). Zero cleartext ever reaches Traceprompt servers. The hash chain provides tamper evidence without exposing content.

### How does agent tracing differ from LLM tracing?

Agent tracing provides **complete workflow observability**:

- **`wrap()`**: Traces individual LLM calls (ModelCall spans)
- **`wrapTool()`**: Traces tool executions (ToolCall + ToolResult spans)
- **`wrapAgent()`**: Traces entire agent sessions (AgentRun as root span)

Each trace maintains **parent-child relationships** and **hash-chain integrity** for complete audit trails of AI decision-making workflows.

### Do I need to configure agent identity?

No, but it's **highly recommended for compliance**. Agent identity can be configured via:

1. **`.tracepromptrc.yml`** (recommended)
2. **Environment variables** (`TRACEPROMPT_AGENT_*`)
3. **Explicit parameters** to `wrapAgent()`

Without configuration, agents get auto-generated names and IDs, but stable identity helps auditors track agent versions and changes over time.

---
