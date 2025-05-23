import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { Transport } from "../network/transporter";

export async function flushBatch(batch: QueueItem[]) {
  const body = {
    tenantId: ConfigManager.cfg.tenantId,
    records: batch.map((r) => ({ payload: r.payload, leafHash: r.leafHash })),
  };
  await Transport.post("/v1/ingest", body);
}
