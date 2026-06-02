import type { Logger } from "../logger.js";
import type { NotificationEvent, Notifier } from "./types.js";

/**
 * Webhook notifier: POSTs each NotificationEvent as JSON to a configured URL.
 * Fire-and-forget — failures are logged but don't block the originating tool
 * call. The receiving endpoint can adapt the payload to Slack / Telegram /
 * Discord / email / your own UI.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notify(event: NotificationEvent): Promise<void> {
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "monad-mcp/0.1" },
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        this.logger.warn("notifier webhook returned non-2xx", {
          status: res.status,
          url: this.url,
        });
      }
    } catch (err) {
      this.logger.warn("notifier webhook failed", {
        error: err instanceof Error ? err.message : String(err),
        url: this.url,
      });
    }
  }
}

export class NoopNotifier implements Notifier {
  async notify(_event: NotificationEvent): Promise<void> {
    // intentional no-op when no notification channel is configured
  }
}
