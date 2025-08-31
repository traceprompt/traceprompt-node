export {
  init,
  wrap,
  wrapTool,
  wrapAgent,
  startSpan,
  getCurrentContext,
} from "./wrapper";
export { decryptBundle } from "./crypto/encryptor";
export { registry } from "./metrics";
export { PersistentBatcher } from "./queue/persistentBatcher";

export type {
  TracepromptInit,
  WrapOpts,
  EncryptedBundle,
  SpanKind,
  SpanContext,
} from "./types";
