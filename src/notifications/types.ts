import type { StoredRequest } from "../store/types.js";

export interface NotificationEvent {
  type: "request_created" | "request_approved" | "request_rejected" | "request_expired";
  request: Pick<
    StoredRequest,
    "id" | "userId" | "network" | "walletAddress" | "summary" | "status" | "txHash" | "expiresAt"
  >;
  approval_url?: string;
}

export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}
