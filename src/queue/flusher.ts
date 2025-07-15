import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { Transport } from "../network/transport";

export async function flushBatch(batch: QueueItem[]): Promise<void> {
  const { orgId } = ConfigManager.cfg;

  const body = {
    orgId,
    records: batch.map(({ payload, leafHash }) => ({
      payload,
      leafHash,
    })),
  };

  await Transport.post("/v1/ingest", body);
}
