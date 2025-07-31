import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { Transport } from "../network/transport";

export async function flushBatch(batch: QueueItem[]): Promise<void> {
  // orgId is now resolved from the API key by the server, not sent in request body
  const body = {
    records: batch.map(({ payload, leafHash }) => ({
      payload,
      leafHash,
    })),
  };

  await Transport.post("/v1/ingest", body);
}
