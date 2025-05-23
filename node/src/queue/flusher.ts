/**
 * queue/flusher.ts
 * ------------------------------------------------------
 * Responsible for actually delivering a batch of
 * encrypted records to the ingest endpoint.  Throws on
 * error so the caller (Batcher) can re-queue items and
 * increment failure metrics.
 * ------------------------------------------------------
 */

import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { Transport } from "../network/transport";

/**
 * POST the batch to /v1/ingest.
 *
 * @throws  Propagates any network/HTTP error for the
 *          caller to handle (retry, metric increment).
 */
export async function flushBatch(batch: QueueItem[]): Promise<void> {
  const { tenantId } = ConfigManager.cfg;

  const body = {
    tenantId,
    records: batch.map(({ payload, leafHash }) => ({
      payload,
      leafHash,
    })),
  };

  await Transport.post("/v1/ingest", body);
}
