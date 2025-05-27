import { fetch } from "undici";
import { ConfigManager } from "../config";
import { retry } from "../utils/retry";
import { log } from "../utils/logger";

type HttpMethod = "POST" | "PUT" | "PATCH";

interface PostOptions {
  path: string;
  body: unknown;
  method?: HttpMethod;
  retries?: number;
  headers?: Record<string, string>;
}

export const Transport = {
  async post(
    path: string,
    body: unknown,
    retries = 5,
    headers?: Record<string, string>
  ): Promise<void> {
    await sendJson({ path, body, retries, method: "POST", headers });
  },
};

async function sendJson(opts: PostOptions): Promise<void> {
  const { ingestUrl, apiKey } = ConfigManager.cfg;
  const url = new URL(opts.path, ingestUrl).toString();
  const extra = opts.headers ?? {};

  log.verbose(`Sending request to ${opts.path}`, {
    url: url,
    method: opts.method ?? "POST",
    retries: opts.retries ?? 5,
    hasBody: !!opts.body,
  });

  await retry(
    async () => {
      const res = await fetch(url, {
        method: opts.method ?? "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "traceprompt-sdk/0.1.0",
          "x-api-key": apiKey,
          ...extra,
        },
        body: JSON.stringify(opts.body),
      });

      if (res.status >= 400) {
        const msg = await res.text();
        const errorMessage = `HTTP ${res.status} - ${msg}`;

        if (res.status >= 500) {
          log.warn(`Server error (will retry): ${errorMessage}`, {
            status: res.status,
            url: url,
            response: msg,
          });
        } else if (res.status === 429) {
          log.warn(`Rate limited (will retry): ${errorMessage}`, {
            status: res.status,
            url: url,
            response: msg,
          });
        } else if (res.status === 401 || res.status === 403) {
          log.error(`Authentication/authorization error: ${errorMessage}`, {
            status: res.status,
            url: url,
            response: msg,
            hint: "Check your API key and tenant permissions",
          });
        } else {
          log.error(`Client error: ${errorMessage}`, {
            status: res.status,
            url: url,
            response: msg,
          });
        }

        throw new Error(`Traceprompt: ${errorMessage}`);
      }

      log.debug(`Request successful`, {
        status: res.status,
        url: url,
      });
    },
    opts.retries ?? 5,
    250,
    (error: unknown, attempt: number) => {
      log.verbose(`Request attempt ${attempt} failed, retrying...`, {
        error: error instanceof Error ? error.message : String(error),
        attempt: attempt,
        maxRetries: opts.retries ?? 5,
        url: url,
      });
    }
  );

  log.verbose(`Request completed successfully`, { url: url });
}
