import { request } from "undici";
import { ConfigManager } from "../config";
import { retry } from "../utils/retry";

export const Transport = {
  post: (path: string, body: unknown) =>
    retry(async () => {
      const { ingestUrl } = ConfigManager.cfg;
      const res = await request(`${ingestUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        maxRedirections: 0,
      });
      if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
    }, 5),
};
