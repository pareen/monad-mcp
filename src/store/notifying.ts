import type { Config } from "../config.js";
import type { Notifier } from "../notifications/types.js";
import type { CreateStoredRequestInput, RequestStore, StoredRequest } from "./types.js";

/**
 * Wraps a RequestStore so every create/markApproved/markRejected/markExpired
 * fires the notifier in the background. Failures from the notifier are
 * swallowed (logged inside the notifier) — they must never block a tool call.
 */
export class NotifyingRequestStore implements RequestStore {
  constructor(
    private readonly inner: RequestStore,
    private readonly notifier: Notifier,
    private readonly config: Pick<Config, "publicBaseUrl">,
  ) {}

  async create(input: CreateStoredRequestInput): Promise<StoredRequest> {
    const created = await this.inner.create(input);
    void this.notifier.notify({
      type: "request_created",
      request: this.publicShape(created),
      approval_url: `${this.config.publicBaseUrl}/approve/${created.id}`,
    });
    return created;
  }

  async get(id: string): Promise<StoredRequest | null> {
    return this.inner.get(id);
  }

  async markApproved(id: string, txHash: `0x${string}`): Promise<StoredRequest> {
    const updated = await this.inner.markApproved(id, txHash);
    void this.notifier.notify({ type: "request_approved", request: this.publicShape(updated) });
    return updated;
  }

  async markRejected(id: string, reason?: string): Promise<StoredRequest> {
    const updated = await this.inner.markRejected(id, reason);
    void this.notifier.notify({ type: "request_rejected", request: this.publicShape(updated) });
    return updated;
  }

  async markExpired(id: string): Promise<StoredRequest> {
    const updated = await this.inner.markExpired(id);
    void this.notifier.notify({ type: "request_expired", request: this.publicShape(updated) });
    return updated;
  }

  private publicShape(r: StoredRequest) {
    return {
      id: r.id,
      userId: r.userId,
      network: r.network,
      walletAddress: r.walletAddress,
      summary: r.summary,
      status: r.status,
      txHash: r.txHash,
      expiresAt: r.expiresAt,
    };
  }
}
