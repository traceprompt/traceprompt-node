# TracepPrompt SDKs

Tamper-proof AI logs for audit and compliance. Multiple language SDKs for encrypting and tracking LLM prompts/responses.

## Architecture

- **Encrypt-first**: AES-256-GCM envelope encryption with customer's CMK
- **Hash chain integrity**: BLAKE3 hashing with Merkle tree anchoring
- **Zero clear-text storage**: All data encrypted client-side
- **Multi-language support**: Node.js, Python, Go, and more

## SDKs

| Language               | Package                     | Status     | Directory                |
| ---------------------- | --------------------------- | ---------- | ------------------------ |
| **Node.js/TypeScript** | `@traceprompt/node`         | ✅ Active  | [`./node/`](./node/)     |
| **Python**             | `traceprompt`               | 🚧 Planned | [`./python/`](./python/) |
| **Go**                 | `github.com/traceprompt/go` | 🚧 Planned | [`./go/`](./go/)         |
| **Rust**               | `traceprompt-rust`          | 📋 Future  | [`./rust/`](./rust/)     |

## Development

Each SDK is **completely self-contained**. Work directly in the SDK directory:

### Node.js SDK

```bash
cd node/
yarn install && yarn build
yarn test
yarn publish-sdk
```

### Python SDK

```bash
cd python/
pip install -e ".[dev]"
pytest
python -m build
```

### Go SDK

```bash
cd go/
go mod download && go build
go test ./...
```

## Convenience Scripts (from root)

```bash
# Node.js shortcuts
yarn build:node    # builds Node SDK
yarn test:node     # tests Node SDK
yarn publish:node  # publishes Node SDK
```

## Design

See [`design.md`](./design.md) for the complete technical specification.

## License

Apache-2.0
